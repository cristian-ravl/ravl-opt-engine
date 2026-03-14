// Main app entry point for the optimization engine v2 Azure Functions.
// Imports register all HTTP triggers, timer triggers, and Durable Functions orchestrators.

// Register orchestrators (collection & recommendation pipelines)
import './orchestrators/index.js';

// Register REST API endpoints
import './api/index.js';
