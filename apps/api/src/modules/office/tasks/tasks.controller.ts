import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiZodQuery } from '../../../openapi/query';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { TaskNoteBody, TaskRejectBody, TasksQuery } from './tasks.schemas';
import { TasksService } from './tasks.service';

// POST /office/tasks/:id/complete is served by LinesController: closing a task applies a line operation
// (lines/task-completion.ts).
@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class TasksController {
  constructor(private readonly taskDesk: TasksService) {}

  @Get('tasks')
  @ApiOperation({ summary: 'Paged tasks' })
  @ApiZodQuery(TasksQuery)
  @ApiErrorResponse(400, 401, 403)
  tasks(@Actor() actor: ActorShape, @Query() query: TasksQuery) {
    return this.taskDesk.list(actor, query);
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Task ticket detail with timeline' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  task(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.taskDesk.detail(actor, id);
  }

  @Post('tasks/:id/notes')
  @ApiOperation({ summary: 'Add inspection note without closing the task' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(TaskNoteBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_note', 'task', param('id'))
  addTaskNote(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: TaskNoteBody,
  ) {
    return this.taskDesk.addNote(actor, id, body);
  }

  @Post('tasks/:id/take')
  @ApiOperation({ summary: 'Take a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('task_take', 'task', param('id'))
  take(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.taskDesk.take(actor, id);
  }

  @Post('tasks/:id/release')
  @ApiOperation({ summary: 'Release a taken task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('task_release', 'task', param('id'))
  release(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.taskDesk.release(actor, id);
  }

  @Post('tasks/:id/reject')
  @ApiOperation({ summary: 'Reject a task' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(TaskRejectBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_reject', 'task', param('id'))
  reject(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: TaskRejectBody,
  ) {
    return this.taskDesk.reject(actor, id, body);
  }

  @Post('tasks/:id/cancel')
  @ApiOperation({ summary: 'Cancel a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('task_cancel', 'task', param('id'))
  cancel(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.taskDesk.cancel(actor, id);
  }
}
