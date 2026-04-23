// src/compute/types.ts
import type { Process, Station, Operator, TimeBlock } from "../types";

export interface SimulationRequest {
    projectId: string;
    config: {
        processes: Process[];
        stations: Station[];
        operators: Operator[];
        targetVolume: number;
    };
}

export interface SimulationResponse {
    success: boolean;
    timeBlocks: TimeBlock[]; 
    computeTimeMs: number;
    error?: string;
}