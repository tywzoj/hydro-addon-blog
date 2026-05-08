import type { TYPE_TRAINING_LOG } from "./feature/constants";
import type { TrainingLogModel } from "./feature/model";
import type { TrainingLogDoc, TrainingLogStatusDoc } from "./feature/types";

declare module "hydrooj" {
    interface Model {
        trainingLog: typeof TrainingLogModel;
    }
    interface DocType {
        [TYPE_TRAINING_LOG]: TrainingLogDoc;
    }
    interface DocStatusType {
        [TYPE_TRAINING_LOG]: TrainingLogStatusDoc;
    }
}
