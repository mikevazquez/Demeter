"use client";

import { useEffect } from "react";

import { markEvaluationResultViewedAction } from "../../actions";

export function MarkEvaluationResultViewed({ evaluationId }: { evaluationId: string }) {
  useEffect(() => {
    void markEvaluationResultViewedAction(evaluationId);
  }, [evaluationId]);

  return null;
}
