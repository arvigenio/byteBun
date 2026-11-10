// The one email the task board sends: "<admin> assigned you a task", to the admin a task was just
// assigned to. Never sent when an admin assigns a task to themselves (tasks.service.ts decides).
// Admin template: no links (see auth/email-template.ts); the admin opens Tasks in the admin site.
import { adminName } from '../auth/admins';
import { renderEmail } from '../auth/email-template';
import type { Mail } from '../auth/mailer';

const STATE_LABELS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

export interface TaskForEmail {
  id: number;
  title: string;
  description: string | null;
  status: string;
  subtasks: unknown[];
}

/** `to` and `by` are admin emails. */
export function taskAssignedEmail(task: TaskForEmail, to: string, by: string): Mail {
  const byName = adminName(by) ?? by;
  const firstName = adminName(to)?.split(' ')[0];
  const details: [string, string][] = [
    ['Task', `#${task.id}`],
    ['State', STATE_LABELS[task.status] ?? task.status],
    ['Assigned by', byName],
  ];
  if (task.subtasks.length) details.push(['Subtasks', String(task.subtasks.length)]);
  if (task.description) details.push(['Details', task.description]);

  const rendered = renderEmail({
    preheader: `${byName} assigned you “${task.title}”.`,
    label: 'Task assigned to you',
    tone: 'info',
    title: task.title,
    intro: [`${firstName ? `Hi ${firstName}, ` : ''}${byName} assigned this task to you.`],
    details,
    outro: ['Open Tasks in the Byte Bun admin site to see it and its subtasks.'],
    footer: 'Sent when another admin assigns a task to you. Tasks you assign to yourself are not emailed.',
  });
  return { to, subject: `${byName} assigned you a task: ${task.title}`, ...rendered };
}
