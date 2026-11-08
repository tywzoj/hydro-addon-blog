import type { BlogDoc } from "../shared/types";

export function articleForResponse(doc: BlogDoc): BlogDoc {
    const result = { ...doc };
    delete result.ip;
    if (doc.reply) {
        result.reply = doc.reply.map((reply) => {
            const visible = { ...reply };
            delete visible.ip;
            return visible;
        });
    }
    return result;
}

export function articleForReader(doc: BlogDoc, uid: number, canReview = false): BlogDoc {
    const result = { ...doc };
    delete result.pendingReportWrite;
    delete result.rejectionCount;
    if (doc.owner !== uid) {
        delete result.writeRevision;
        delete result.contentVersion;
        delete result.counterEpoch;
        delete result.requiresReview;
        delete result.reviewReason;
        delete result.reviewPending;
        delete result.reviewGeneration;
        delete result.reviewQueuedAt;
        delete result.reportApprovedVersion;
        delete result.lastReview;
    }
    if (!canReview) delete result.reportCount;
    return result;
}
