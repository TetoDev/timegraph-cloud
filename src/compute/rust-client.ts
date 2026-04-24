// src/compute/rust-client.ts
import type { SimulationRequest, SimulationResponse } from "./types";

const RUST_ENGINE_URL = process.env.RUST_ENGINE_URL || "http://localhost:8080/compute";

export const RustComputeClient = {

    async calculateSimulation(request: SimulationRequest): Promise<SimulationResponse> {
        try {
            console.log(`🚀 Sending Project ${request.projectId} to Rust Engine...`);
            
            const response = await fetch(RUST_ENGINE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(request),

                signal: AbortSignal.timeout(30000) 
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Rust Engine Error (${response.status}): ${errorBody}`);
            }

            const result = await response.json() as SimulationResponse;
            console.log(`✅ Simulation complete. Rust took ${result.computeTimeMs}ms`);
            
            return result;

        } catch (error: any) {
            console.error("❌ Failed to reach Rust Compute Engine:", error.message);
            return {
                success: false,
                timeBlocks: [],
                computeTimeMs: 0,
                error: error.message
            };
        }
    }
};