import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { format } from "prettier";

const httpMethods = ["get", "post", "put", "patch", "delete"];
const routeRoots = ["frontend/src/app/api/v1", "frontend/src/app/health"];

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await routeFiles(target)));
    else if (entry.name === "route.ts") files.push(target);
  }
  return files;
}

function openApiPath(file) {
  const relative = path.relative("frontend/src/app", path.dirname(file));
  return `/${relative.replaceAll(path.sep, "/").replaceAll(/\[([^\]]+)\]/gu, "{$1}")}`;
}

function operationId(method, apiPath) {
  const suffix = apiPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll(/[{}-]/gu, "_"))
    .join("_");
  return `${method}_${suffix}`;
}

function parametersFor(apiPath, mutation) {
  const parameters = [...apiPath.matchAll(/\{([^}]+)\}/gu)].map((match) => ({
    in: "path",
    name: match[1],
    required: true,
    schema: { format: "uuid", type: "string" },
  }));
  if (mutation) {
    parameters.push({
      description: "Required replay-protection key for every mutation.",
      in: "header",
      name: "idempotency-key",
      required: true,
      schema: { maxLength: 200, minLength: 8, type: "string" },
    });
  }
  return parameters;
}

function response(description) {
  return {
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiEnvelope" } } },
    description,
  };
}

function operation(method, apiPath) {
  if (apiPath.startsWith("/health/")) {
    return {
      operationId: operationId(method, apiPath),
      responses: {
        200: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } },
          },
          description: "Process or dependency health is available",
        },
        ...(apiPath === "/health/ready"
          ? {
              503: {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/HealthResponse" },
                  },
                },
                description: "A required dependency is unavailable",
              },
            }
          : {}),
      },
      summary: `${method.toUpperCase()} ${apiPath}`,
    };
  }
  const mutation = method !== "get";
  return {
    operationId: operationId(method, apiPath),
    parameters: parametersFor(apiPath, mutation),
    responses: {
      200: response("Successful response"),
      400: response("Request validation failed"),
      401: response("Cron invocation is unauthorized"),
      404: response("Resource not found"),
      409: response("State or idempotency conflict"),
      413: response("Request body exceeds the route limit"),
      422: response("Safety or business rule blocked the operation"),
      429: response("Request rate limit exceeded"),
      500: response("Unexpected internal failure"),
      503: response("Required dependency unavailable"),
    },
    ...(mutation
      ? {
          requestBody: {
            content: {
              "application/json": { schema: { additionalProperties: true, type: "object" } },
            },
            required: true,
          },
        }
      : {}),
    summary: `${method.toUpperCase()} ${apiPath}`,
  };
}

export async function buildOpenApiDocument() {
  const paths = {};
  for (const root of routeRoots) {
    for (const file of (await routeFiles(root)).sort()) {
      const source = await readFile(file, "utf8");
      const apiPath = openApiPath(file);
      const methods = [
        ...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gu),
      ]
        .map((match) => match[1].toLowerCase())
        .filter((method) => httpMethods.includes(method));
      if (methods.length === 0) throw new Error(`No public HTTP method found in ${file}.`);
      paths[apiPath] ??= {};
      for (const method of methods.sort()) paths[apiPath][method] = operation(method, apiPath);
    }
  }

  return {
    components: {
      schemas: {
        ApiEnvelope: {
          additionalProperties: false,
          properties: {
            data: {},
            error: {
              anyOf: [{ $ref: "#/components/schemas/ApiError" }, { type: "null" }],
            },
            meta: { $ref: "#/components/schemas/ApiMeta" },
          },
          required: ["data", "error", "meta"],
          type: "object",
        },
        ApiError: {
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            details: { type: "object" },
            message: { type: "string" },
          },
          required: ["code", "message"],
          type: "object",
        },
        ApiMeta: {
          additionalProperties: true,
          properties: { requestId: { format: "uuid", type: "string" } },
          required: ["requestId"],
          type: "object",
        },
        HealthResponse: {
          additionalProperties: true,
          properties: {
            dependencies: { additionalProperties: { type: "string" }, type: "object" },
            status: { enum: ["ok", "ready", "unavailable"], type: "string" },
          },
          required: ["status"],
          type: "object",
        },
      },
    },
    info: {
      description:
        "Generated public route inventory. Runtime request and response validation is owned by @spotter/contracts Zod schemas.",
      title: "Spotter V1 API",
      version: "1.0.0",
    },
    openapi: "3.1.0",
    paths,
  };
}

export async function serializeOpenApiDocument(document) {
  return format(JSON.stringify(document), { parser: "json", printWidth: 100 });
}
