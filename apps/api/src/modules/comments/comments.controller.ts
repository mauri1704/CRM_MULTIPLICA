import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { COMMENT_TARGETS, commentInput, type CommentInput, type CommentTarget } from '@crm/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody } from '../../common/zod';
import { CommentsService } from './comments.service';

const editBody = z.object({ body: z.string().trim().min(1, 'Escriba el comentario.').max(5000) });

function targetOf(v: string): CommentTarget {
  const t = v.toUpperCase();
  if (!(COMMENT_TARGETS as readonly string[]).includes(t)) throw notFound();
  return t as CommentTarget;
}

@ApiTags('Comentarios')
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get(':type/:id')
  list(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id', UuidPipe) id: string,
  ) {
    return this.comments.list(user, targetOf(type), id);
  }

  @Post(':type/:id')
  @ZodBody(commentInput)
  create(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id', UuidPipe) id: string,
    @Body() body: CommentInput,
  ) {
    return this.comments.create(user, targetOf(type), id, body);
  }

  @Patch(':commentId')
  @ZodBody(editBody)
  update(
    @CurrentUser() user: AuthUser,
    @Param('commentId', UuidPipe) id: string,
    @Body() body: z.infer<typeof editBody>,
  ) {
    return this.comments.update(user, id, body.body);
  }

  @Delete(':commentId')
  async remove(@CurrentUser() user: AuthUser, @Param('commentId', UuidPipe) id: string) {
    await this.comments.remove(user, id);
    return { ok: true };
  }
}
