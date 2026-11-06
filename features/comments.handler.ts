import type { ObjectId } from "hydrooj";
import { MessageModel, OplogModel, param, Types, UserModel } from "hydrooj";

import { BlogCommentModel, commentIds, commentOwners } from "./comments.model";
import {
    BLOG_COMMENT_NOTICE_LENGTH,
    BLOG_COMMENT_RATE_LIMIT,
    BlogAuditEvents,
    BlogMessages,
    ROUTE_BLOG_POST_DETAIL,
    SYSTEM_DOMAIN,
} from "./constants";
import { BlogUserPostBaseHandler } from "./handler.base";

export class BlogCommentHandler extends BlogUserPostBaseHandler {
    post() {
        this.requireRead();
        this.blog.requireLogin();
    }

    async loadComments(page: number) {
        const [comments, pcount, drcount] = await this.paginate(
            BlogCommentModel.getMulti(this.ddoc.docId),
            page,
            "reply",
        );
        const [udict, liked] = await Promise.all([
            UserModel.getList(SYSTEM_DOMAIN, commentOwners(comments)),
            BlogCommentModel.getLikes(
                this.ddoc.docId,
                commentIds(comments),
                this.blog.authenticated ? this.user._id : 0,
            ),
        ]);
        return {
            comments: comments.map((comment) => ({
                ...comment,
                canDelete: this.blog.canDeleteComment(this.ddoc, comment.owner),
                reply: (comment.reply || []).map((reply) => ({
                    ...reply,
                    canDelete: this.blog.canDeleteComment(this.ddoc, reply.owner, true),
                })),
            })),
            commentUsers: udict,
            liked,
            page,
            pcount,
            drcount,
            canComment: this.blog.canComment(this.ddoc),
        };
    }

    commentUrl() {
        return this.url(ROUTE_BLOG_POST_DETAIL, { uid: this.ddoc.owner, did: this.ddoc.docId });
    }

    async notifyMentions(content: string) {
        const ids = [...new Set(Array.from(content.matchAll(/@\[\]\(\/user\/(\d+)\)/g), (match) => +match[1]))];
        const users = await UserModel.getList(SYSTEM_DOMAIN, ids);
        await MessageModel.send(
            1,
            Object.keys(users).map(Number),
            JSON.stringify({
                message: "User {0} mentioned you in {1:link}",
                params: [this.user.uname, this.commentUrl()],
            }),
            MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD,
        );
    }

    async limitComment() {
        await this.limitRate(
            BLOG_COMMENT_RATE_LIMIT.Operation,
            BLOG_COMMENT_RATE_LIMIT.PeriodSeconds,
            BLOG_COMMENT_RATE_LIMIT.MaxOperations,
        );
    }

    @param("content", Types.Content)
    async postReply(_, content: string) {
        this.blog.requireComment(this.ddoc);
        await this.limitComment();
        await this.notifyMentions(content);
        const drid = await BlogCommentModel.add(this.ddoc.docId, this.user._id, content, this.request.ip);
        this.back({ drid });
    }

    @param("drid", Types.ObjectId)
    @param("content", Types.Content)
    async postTailReply(_, drid: ObjectId, content: string) {
        this.blog.requireComment(this.ddoc);
        await BlogCommentModel.get(this.ddoc.docId, drid);
        await this.limitComment();
        await this.notifyMentions(content);
        const drrid = await BlogCommentModel.addTail(this.ddoc.docId, drid, this.user._id, content, this.request.ip);
        this.back({ drrid });
    }

    async deleteComment(drid: ObjectId, drrid?: ObjectId) {
        this.post();
        const { target } = await BlogCommentModel.get(this.ddoc.docId, drid, drrid);
        this.blog.requireDeleteComment(this.ddoc, target.owner, !!drrid);
        const excerpt =
            target.content.length > BLOG_COMMENT_NOTICE_LENGTH
                ? `${target.content.substring(0, BLOG_COMMENT_NOTICE_LENGTH)}...`
                : target.content;
        const deleteBy = this.user._id === this.ddoc.owner ? "BlogOwner" : "Admin";
        const notice = drrid
            ? {
                  message: BlogMessages.TailReplyDeleted,
                  params: [this.user.uname, excerpt, this.ddoc.title, this.commentUrl()],
              }
            : {
                  message: BlogMessages.CommentDeleted,
                  params: [deleteBy, this.user.uname, excerpt, this.ddoc.title, this.commentUrl()],
              };
        await Promise.all([
            BlogCommentModel.delete(this.ddoc.docId, drid, drrid),
            target.owner !== this.user._id &&
                MessageModel.send(
                    1,
                    target.owner,
                    JSON.stringify(notice),
                    MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD,
                ),
            OplogModel.log(this, drrid ? BlogAuditEvents.DeleteTailReply : BlogAuditEvents.DeleteComment, target),
        ]);
        this.back();
    }

    @param("drid", Types.ObjectId)
    async postDeleteReply(_, drid: ObjectId) {
        await this.deleteComment(drid);
    }

    @param("drid", Types.ObjectId)
    @param("drrid", Types.ObjectId)
    async postDeleteTailReply(_, drid: ObjectId, drrid: ObjectId) {
        await this.deleteComment(drid, drrid);
    }

    @param("drid", Types.ObjectId)
    @param("drrid", Types.ObjectId, true)
    @param("liked", Types.Boolean, false)
    async postLike(_, drid: ObjectId, drrid: ObjectId | undefined, liked: boolean) {
        this.blog.requireComment(this.ddoc);
        const state = await BlogCommentModel.like(this.ddoc.docId, drid, drrid, this.user._id, liked);
        this.back(state);
    }
}
