import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// The admin task board (/api/admin/tasks): a kanban of tasks with subtasks.
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
