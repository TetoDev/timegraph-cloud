// src/types.ts

export enum TaskState {
    START = "START",
    FINISH = "FINISH",
    WAIT = "WAIT",
    FOLLOW = "FOLLOW"
}

export enum StationState {
    FREE = "FREE",
    USED = "USED"
}

export enum CycleBehavior {
    ALL_CYCLES = "ALL_CYCLES",
    WARMUP_ONLY = "WARMUP_ONLY",
    STEADY_STATE = "STEADY_STATE"
}

export enum OperatorLogic {
    AND = "AND",
    OR = "OR"
}

export interface Operator {
    uuid: string;
    operatorNumber: number;
    isRobot: boolean;
    capacity: number;
}

export interface OperatorRequirement {
    operators: string[];
    logicType: OperatorLogic;
}

export interface Station {
    uuid: string;
    name: string;
    state: StationState;
    capacity: number;
    colorIndex: number;
}

export interface ProcessCondition {
    uuid: string;
    processUuid: string;
    taskUuid: string;
    taskState: TaskState;
    waitTime: number;
    cycleOffset: number;
}

export interface StationCondition {
    uuid: string;
    stationUuid: string;
    stationState: StationState;
}

export interface Process {
    uuid: string;
    name: string;
    duration: number;
    operatorRequirement: OperatorRequirement;
    allowedStationUuids: string[];
    processConditions: ProcessCondition[];
    stationConditions: StationCondition[];
    cycleBehavior: CycleBehavior;
    isValueAdded?: boolean;
    references?: Record<string, number>;
    isPeriodic: boolean;
    periodicInterval: number;
    periodicUnit: "cycles" | "days";
}

export interface TimeBlock {
    task: {
        uuid: string;
        process: Process;
        startTime: number;
        duration: number;
        partNumber: number;
        processConditions: ProcessCondition[];
    };
    operator: Operator;
    station: Station;
}
