import type { AskUserQuestionResult } from "./ask-user-question-schema";
import { PendingResolverRegistry } from "./pending-resolver-registry";

export const askUserQuestionPendingRegistry =
  new PendingResolverRegistry<AskUserQuestionResult>();
