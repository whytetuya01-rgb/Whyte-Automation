"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/apiClient";
import { STAGE_PROBABILITY } from "@/lib/pipelineProbability";
import type { LeadStatus } from "@/types/crm";

interface StageProbabilityState {
  stages: Record<LeadStatus, number>;
  canManage: boolean;
}

/**
 * The company's default win chance per pipeline stage, for screens that show or preview a forecast. Until the answer
 * arrives (or if it cannot be read) the built-in defaults are used, so a forecast is never blank.
 */
export function useStageProbabilities(): StageProbabilityState & { reload: () => Promise<void> } {
  const [state, setState] = useState<StageProbabilityState>({ stages: { ...STAGE_PROBABILITY }, canManage: false });

  const reload = useCallback(async () => {
    try {
      const res = await apiJson.get<{ stages: Record<LeadStatus, number>; canManage: boolean }>("/api/crm/stage-probabilities");
      if (res?.stages) setState({ stages: res.stages, canManage: Boolean(res.canManage) });
    } catch {
      /* keep the built-in defaults */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
