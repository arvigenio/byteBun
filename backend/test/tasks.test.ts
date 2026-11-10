// The admin task board: columns, ordering, subtasks (in their own columns), and clearing the
// board once all is done.
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { outbox } from '../src/auth/mailer';
import { ARVI, type Browser, browser, enroll, JOSUE, ORIGIN, resetState, settle, startApp, type TestApp, waitForMail } from './helpers';

let t: TestApp;
before(async () => {
  t = await startApp();
});
after(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetState(t.prisma);
});

async function admin(): Promise<Browser> {
  const b = browser(t.server);
  await enroll(b, JOSUE);
  return b;
}
const board = async (b: Browser) => (await b.get('/api/admin/tasks')).body.tasks as any[];
const column = (tasks: any[], status: string) => tasks.filter((x) => x.status === status).map((x) => x.title);

describe('admin task board', () => {
  it('is only for signed-in admins', async () => {
    assert.equal((await request(t.server).get('/api/admin/tasks')).status, 401);
    assert.equal((await request(t.server).post('/api/admin/tasks').set('Origin', ORIGIN).send({ title: 'x' })).status, 401);
    assert.equal((await request(t.server).delete('/api/admin/tasks').set('Origin', ORIGIN)).status, 401);
  });

  it('creates tasks on top of their column and validates them', async () => {
    const b = await admin();
    const first = await b.post('/api/admin/tasks', { title: '  Write   the proposal ', description: 'For the dental clinic' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.title, 'Write the proposal');
    assert.equal(first.body.status, 'todo');
    assert.equal(first.body.createdBy, JOSUE);
    assert.deepEqual(first.body.subtasks, []);
    await b.post('/api/admin/tasks', { title: 'Call Maria' });
    await b.post('/api/admin/tasks', { title: 'Already shipped', status: 'done' });
    const tasks = await board(b);
    assert.deepEqual(column(tasks, 'todo'), ['Call Maria', 'Write the proposal']);
    assert.ok(tasks.find((x) => x.title === 'Already shipped').completedAt);

    const bad = await b.post('/api/admin/tasks', { title: '   ' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields.title);
    assert.equal((await b.post('/api/admin/tasks', { title: 'x', status: 'someday' })).status, 400);
    assert.equal((await b.post('/api/admin/tasks', { title: 'x'.repeat(201) })).status, 400);
  });

  it('moves tasks between columns and reorders them', async () => {
    const b = await admin();
    const ids: Record<string, number> = {};
    for (const title of ['C', 'B', 'A']) ids[title] = (await b.post('/api/admin/tasks', { title })).body.id; // todo: A, B, C

    const moved = await b.patch(`/api/admin/tasks/${ids.B}`, { status: 'in_progress' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.status, 'in_progress');
    let tasks = await board(b);
    assert.deepEqual(column(tasks, 'todo'), ['A', 'C']);
    assert.deepEqual(column(tasks, 'in_progress'), ['B']);

    await b.patch(`/api/admin/tasks/${ids.C}`, { position: 0 }); // C above A
    await b.patch(`/api/admin/tasks/${ids.A}`, { status: 'in_progress', position: 5 }); // to the bottom
    tasks = await board(b);
    assert.deepEqual(column(tasks, 'todo'), ['C']);
    assert.deepEqual(column(tasks, 'in_progress'), ['B', 'A']);

    const done = await b.patch(`/api/admin/tasks/${ids.A}`, { status: 'done' });
    assert.ok(done.body.completedAt);
    const back = await b.patch(`/api/admin/tasks/${ids.A}`, { status: 'todo', title: 'A again' });
    assert.equal(back.body.completedAt, null);
    assert.equal(back.body.title, 'A again');
    assert.equal((await b.patch('/api/admin/tasks/9999', { status: 'done' })).status, 404);
  });

  it('adds, renames and deletes subtasks', async () => {
    const b = await admin();
    const task = (await b.post('/api/admin/tasks', { title: 'Launch site' })).body;
    const one = await b.post(`/api/admin/tasks/${task.id}/subtasks`, { title: 'Logo' });
    assert.equal(one.status, 201);
    const two = await b.post(`/api/admin/tasks/${task.id}/subtasks`, { title: 'Copy' });
    assert.deepEqual(two.body.subtasks.map((s: any) => s.title), ['Logo', 'Copy']);
    const [logo, copy] = two.body.subtasks;

    assert.deepEqual(logo, { id: logo.id, title: 'Logo', status: 'todo', position: 0 });
    assert.deepEqual([copy.status, copy.position], ['todo', 1]);

    const changed = await b.patch(`/api/admin/tasks/${task.id}/subtasks/${logo.id}`, { status: 'done', title: 'Logo files' });
    assert.deepEqual(changed.body.subtasks.find((s: any) => s.id === logo.id), { id: logo.id, title: 'Logo files', status: 'done', position: 0 });
    const removed = await b.delete(`/api/admin/tasks/${task.id}/subtasks/${copy.id}`);
    assert.deepEqual(removed.body.subtasks.map((s: any) => s.id), [logo.id]);

    // A subtask of another task, or one that's gone, is a 404.
    const other = (await b.post('/api/admin/tasks', { title: 'Other' })).body;
    assert.equal((await b.patch(`/api/admin/tasks/${other.id}/subtasks/${logo.id}`, { status: 'todo' })).status, 404);
    assert.equal((await b.delete(`/api/admin/tasks/${task.id}/subtasks/${copy.id}`)).status, 404);
    assert.equal((await b.post('/api/admin/tasks/9999/subtasks', { title: 'x' })).status, 404);
    assert.equal((await b.post(`/api/admin/tasks/${task.id}/subtasks`, { title: '' })).status, 400);
    assert.equal((await b.patch(`/api/admin/tasks/${task.id}/subtasks/${logo.id}`, { status: 'someday' })).status, 400);
    assert.equal((await b.patch(`/api/admin/tasks/${task.id}/subtasks/${logo.id}`, { position: -1 })).status, 400);
  });

  it('moves subtasks between columns and reorders them, per task', async () => {
    const b = await admin();
    const task = (await b.post('/api/admin/tasks', { title: 'Launch site' })).body;
    const other = (await b.post('/api/admin/tasks', { title: 'Other' })).body;
    const far = (await b.post(`/api/admin/tasks/${other.id}/subtasks`, { title: 'Elsewhere' })).body.subtasks[0];
    const ids: Record<string, number> = {};
    for (const title of ['A', 'B', 'C']) {
      const subs = (await b.post(`/api/admin/tasks/${task.id}/subtasks`, { title })).body.subtasks;
      ids[title] = subs.find((s: any) => s.title === title).id; // todo: A, B, C
    }
    const url = (title: string) => `/api/admin/tasks/${task.id}/subtasks/${ids[title]}`;
    const columns = (body: any) =>
      ['todo', 'in_progress', 'done'].map((status) =>
        body.subtasks
          .filter((s: any) => s.status === status)
          .sort((x: any, y: any) => x.position - y.position)
          .map((s: any) => s.title),
      );

    let res = await b.patch(url('B'), { status: 'in_progress' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(columns(res.body), [['A', 'C'], ['B'], []]);

    await b.patch(url('C'), { position: 0 }); // C above A
    res = await b.patch(url('A'), { status: 'in_progress', position: 5 }); // to the bottom
    assert.deepEqual(columns(res.body), [['C'], ['B', 'A'], []]);
    res = await b.patch(url('C'), { status: 'in_progress', position: 1 }); // between B and A
    assert.deepEqual(columns(res.body), [[], ['B', 'C', 'A'], []]);
    assert.deepEqual(res.body.subtasks.map((s: any) => s.position).sort(), [0, 1, 2]);

    // The task itself and the other task's subtasks stay where they were.
    assert.equal(res.body.status, 'todo');
    const tasks = await board(b);
    assert.deepEqual(tasks.find((x) => x.id === other.id).subtasks, [{ id: far.id, title: 'Elsewhere', status: 'todo', position: 0 }]);
  });

  it('assigns tasks, and emails an admin only when another admin assigns one to them', async () => {
    const b = await admin(); // Josue
    const assignedMails = () => outbox.filter((m) => m.subject.includes('assigned you a task'));
    const listed = await b.get('/api/admin/tasks');
    assert.deepEqual(listed.body.admins.map((a: any) => a.email).sort(), [ARVI, JOSUE].sort());

    // To the other admin: they are emailed.
    const task = (await b.post('/api/admin/tasks', { title: 'Call the clinic', description: 'Ask for Dr. Santos', assignedTo: ARVI })).body;
    assert.equal(task.assignedTo, ARVI);
    const mail = await waitForMail((m) => m.subject === 'Josue Mapagdalita assigned you a task: Call the clinic');
    assert.equal(mail.to, ARVI);
    assert.match(mail.text, /Hi Arvi, Josue Mapagdalita assigned this task to you\./);
    assert.match(mail.text, /Ask for Dr\. Santos/);

    // To yourself, to nobody, or without changing who it is assigned to: nobody is emailed.
    const mine = (await b.post('/api/admin/tasks', { title: 'My own', assignedTo: JOSUE })).body;
    assert.equal(mine.assignedTo, JOSUE);
    assert.equal((await b.post('/api/admin/tasks', { title: 'Nobody yet' })).body.assignedTo, null);
    assert.equal((await b.patch(`/api/admin/tasks/${task.id}`, { assignedTo: ARVI, title: 'Call the clinic today' })).body.assignedTo, ARVI);
    await b.patch(`/api/admin/tasks/${task.id}`, { status: 'in_progress' });
    assert.equal((await b.patch(`/api/admin/tasks/${task.id}`, { assignedTo: null })).body.assignedTo, null);
    await settle();
    assert.equal(assignedMails().length, 1);

    // Handed over to the other admin: emailed. Taken back: not.
    assert.equal((await b.patch(`/api/admin/tasks/${mine.id}`, { assignedTo: ARVI })).body.assignedTo, ARVI);
    await waitForMail((m) => m.subject === 'Josue Mapagdalita assigned you a task: My own');
    await b.patch(`/api/admin/tasks/${mine.id}`, { assignedTo: JOSUE });
    await settle();
    assert.equal(assignedMails().length, 2);
    assert.ok(assignedMails().every((m) => m.to === ARVI));

    // Only the admins can be assigned.
    assert.equal((await b.post('/api/admin/tasks', { title: 'x', assignedTo: 'someone@example.com' })).status, 400);
    assert.equal((await b.patch(`/api/admin/tasks/${mine.id}`, { assignedTo: 'someone@example.com' })).status, 400);
  });

  it('deletes a task with its subtasks', async () => {
    const b = await admin();
    const task = (await b.post('/api/admin/tasks', { title: 'Temp' })).body;
    await b.post(`/api/admin/tasks/${task.id}/subtasks`, { title: 'Sub' });
    assert.deepEqual((await b.delete(`/api/admin/tasks/${task.id}`)).body, { ok: true });
    assert.deepEqual(await board(b), []);
    assert.equal(await t.prisma.adminSubtask.count(), 0);
    assert.equal((await b.delete(`/api/admin/tasks/${task.id}`)).status, 404);
  });

  it('clears the whole board only once every task and subtask is done', async () => {
    const b = await admin();
    const a = (await b.post('/api/admin/tasks', { title: 'A' })).body;
    const c = (await b.post('/api/admin/tasks', { title: 'C', status: 'done' })).body;
    const sub = (await b.post(`/api/admin/tasks/${c.id}/subtasks`, { title: 'Check' })).body.subtasks[0];

    let res = await b.delete('/api/admin/tasks');
    assert.equal(res.status, 409);
    assert.match(res.body.message, /2 tasks are not finished/); // A is in To do, C has an open subtask

    await b.patch(`/api/admin/tasks/${a.id}`, { status: 'done' });
    res = await b.delete('/api/admin/tasks');
    assert.equal(res.status, 409);
    assert.match(res.body.message, /1 task is not finished/);

    await b.patch(`/api/admin/tasks/${c.id}/subtasks/${sub.id}`, { status: 'in_progress' });
    assert.equal((await b.delete('/api/admin/tasks')).status, 409); // started is not finished

    await b.patch(`/api/admin/tasks/${c.id}/subtasks/${sub.id}`, { status: 'done' });
    res = await b.delete('/api/admin/tasks');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { deleted: 2 });
    assert.deepEqual(await board(b), []);
    assert.equal(await t.prisma.adminSubtask.count(), 0);
  });
});
