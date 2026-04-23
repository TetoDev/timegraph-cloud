// src/compute/rust-client.ts
import type { SimulationRequest, SimulationResponse } from "./types";

// In a cloud setup, this is typically an internal k8s service or env var
const RUST_ENGINE_URL = process.env.RUST_ENGINE_URL || "http://localhost:8080/compute";

export const RustComputeClient = {
    /**
     * Sends project data to the Rust engine and returns the calculated Simogram blocks.
     */
    async calculateSimulation(request: SimulationRequest): Promise<SimulationResponse> {
        try {
            console.log(`🚀 Sending Project ${request.projectId} to Rust Engine...`);
            
            const response = await fetch(RUST_ENGINE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(request),
                // Native Bun fetch supports signal for timeouts
                signal: AbortSignal.timeout(30000) // 30-second compute limit
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