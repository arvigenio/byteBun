// The admin task board. Under /api/admin, so AdminSessionGuard protects every route.
// Every change answers with the changed task (or { ok } / { deleted }); other admins get a live
// "tasks.changed" event and reload the board. A task can be assigned to an admin, who is emailed
// (and told live) unless they assigned it to themselves.
import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import {
  type CreateSubtaskInput,
  type CreateTaskInput,
  createSubtaskSchema,
  createTaskSchema,
  type UpdateSubtaskInput,
  type UpdateTaskInput,
  updateSubtaskSchema,
  updateTaskSchema,
} from './tasks.schema';
import { TasksService } from './tasks.service';

@Controller('admin/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  // GET /api/admin/tasks -> { tasks: [{ id, title, description, status, position, assignedTo, subtasks: [{ id, title, status, position }], ... }],
  //                           admins: [{ name, email }] } (who a task can be assigned to)
  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.tasks.list();
  }

  // POST /api/admin/tasks { title, description?, status?, assignedTo? } -> the new task (top of its column)
  @Post()
  create(@Body(new YupValidationPipe(createTaskSchema)) body: CreateTaskInput, @Req() req: Request) {
    return this.tasks.create(body, { email: req.admin!.user.email });
  }

  // DELETE /api/admin/tasks -> { deleted } (409 unless every task and subtask is done)
  @Delete()
  clearAll() {
    return this.tasks.clearAll();
  }

  // PATCH /api/admin/tasks/:id { title?, description?, status?, position?, assignedTo? } -> the task
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(updateTaskSchema)) body: UpdateTaskInput, @Req() req: Request) {
    return this.tasks.update(id, body, { email: req.admin!.user.email });
  }

  // DELETE /api/admin/tasks/:id (with its subtasks) -> { ok }
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.remove(id);
  }

  // POST /api/admin/tasks/:id/subtasks { title } -> the task (the subtask goes to the bottom of To do)
  @Post(':id/subtasks')
  addSubtask(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(createSubtaskSchema)) body: CreateSubtaskInput) {
    return this.tasks.addSubtask(id, body);
  }

  // PATCH /api/admin/tasks/:id/subtasks/:subId { title?, status?, position? } -> the task
  @Patch(':id/subtasks/:subId')
  updateSubtask(
    @Param('id', ParseIntPipe) id: number,
    @Param('subId', ParseIntPipe) subId: number,
    @Body(new YupValidationPipe(updateSubtaskSchema)) body: UpdateSubtaskInput,
  ) {
    return this.tasks.updateSubtask(id, subId, body);
  }

  // DELETE /api/admin/tasks/:id/subtasks/:subId -> the task
  @Delete(':id/subtasks/:subId')
  removeSubtask(@Param('id', ParseIntPipe) id: number, @Param('subId', ParseIntPipe) subId: number) {
    return this.tasks.removeSubtask(id, subId);
  }
}
