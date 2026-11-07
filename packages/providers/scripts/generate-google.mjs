#!/usr/bin/env node
/**
 * Generates Zod models, the endpoint table and per-endpoint class methods for
 * Google API clients (@googleapis/youtube, @googleapis/youtubeanalytics) from
 * the SDK's own generated typings (.d.ts) and request metadata (.js:
 * url, method, requiredParams, pathParams, mediaUrl).
 *
 * Nothing is hand-invented: every parameter, required flag and response type
 * comes from Google's discovery-generated SDK. Re-run after upgrading the SDK:
 *
 *   node scripts/generate-google.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

const APIS = [
  {
    pkg: "@googleapis/youtube",
    file: "v3",
    ns: "youtube_v3",
    prefix: "YouTube",
    outDir: "youtube",
    classFile: "youtube.class.ts",
    sdkVar: "youtube_v3",
    // Plural resource -> singular noun used in method names.
    nouns: {
      abuseReports: "AbuseReport", activities: "Activities", captions: "Caption", channelBanners: "ChannelBanner",
      channels: "Channels", channelSections: "ChannelSection", comments: "Comment", commentThreads: "CommentThread",
      i18nLanguages: "I18nLanguages", i18nRegions: "I18nRegions", liveBroadcasts: "LiveBroadcast",
      liveChatBans: "LiveChatBan", liveChatMessages: "LiveChatMessage", liveChatModerators: "LiveChatModerator",
      liveStreams: "LiveStream", members: "Members", membershipsLevels: "MembershipsLevels",
      playlistImages: "PlaylistImage", playlistItems: "PlaylistItem", playlists: "Playlist", search: "Search",
      subscriptions: "Subscription", superChatEvents: "SuperChatEvents", tests: "Test", thirdPartyLinks: "ThirdPartyLink",
      thumbnails: "Thumbnail", videoAbuseReportReasons: "VideoAbuseReportReasons", videoCategories: "VideoCategories",
      videos: "Video", videoTrainability: "VideoTrainability", watermarks: "Watermark",
      youtube: "Youtube",
    },
    // Upload methods whose media body is mandatory.
    mediaRequired: ["videos.insert", "captions.insert", "thumbnails.set", "channelBanners.insert", "watermarks.set"],
    // Internal / test-only resources not exposed.
    skip: ["tests.insert", "youtube.v3", "captions.download"],
  },
  {
    pkg: "@googleapis/youtubeanalytics",
    file: "v2",
    ns: "youtubeAnalytics_v2",
    prefix: "YouTubeAnalytics",
    outDir: "youtube-analytics",
    classFile: "youtube-analytics.class.ts",
    sdkVar: "youtubeAnalytics_v2",
    nouns: { groupItems: "GroupItem", groups: "Group", reports: "Reports" },
    mediaRequired: [],
    skip: [],
  },
];

const VERBS = { list: "list", insert: "insert", update: "update", delete: "delete" };

function pascal(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseDts(src) {
  const interfaces = new Map();
  const re = /export interface (Schema\$\w+|Params\$Resource\$[\w$]+)(?: extends StandardParameters)? \{\n(?:([\s\S]*?)\n)?? {4}\}/g;
  for (const m of src.matchAll(re)) {
    const fields = [];
    const body = (m[2] ?? "")
      // Collapse the multi-line `media?: { mimeType?; body? }` object type to one token.
      .replace(/media\?: \{[\s\S]*?\n {8}\};/g, "media?: MEDIA;")
      // Collapse other multi-line inline object types (e.g. relatedPlaylists?: { ... } | null) to one line.
      .replace(/((?:^|\n) {8}[\w$]+\??: )\{\n([\s\S]*?)\n {8}\}( \| null)?;/g, (_, head, inner, nul) =>
        `${head}{ ${inner.replace(/\/\*\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ")} }${nul ?? ""};`)
      .replace(/\/\*\*[\s\S]*?\*\//g, (doc) => doc.replace(/\n/g, " "));
    for (const line of body.split("\n")) {
      const fm = line.match(/^\s*(?:\/\*\*(.*?)\*\/\s*)?([A-Za-z_$][\w$]*)(\?)?: (.+);\s*$/);
      if (!fm) continue;
      const doc = (fm[1] ?? "").replace(/\s*\*\s*/g, " ").trim();
      fields.push({ name: fm[2], optional: Boolean(fm[3]), type: fm[4].trim(), doc });
    }
    interfaces.set(m[1], fields);
  }
  // Method response types: list(params?: Params$Resource$X$Y, options?: MethodOptions): Promise<GaxiosResponseWithHTTP2<T>>
  const responses = new Map();
  for (const m of src.matchAll(/(\w+)\(params\?: (Params\$Resource\$[\w$]+), options\?: MethodOptions\): Promise<GaxiosResponseWithHTTP2<([^>]+)>>/g)) {
    responses.set(m[2], m[3]);
  }
  return { interfaces, responses };
}

function parseJs(src) {
  const methods = [];
  const classRe = /class (Resource\$\w+) \{([\s\S]*?)\n {4}\}\n/g;
  for (const cm of src.matchAll(classRe)) {
    const body = cm[2];
    const methodRe =
      /\n {8}(\w+)\(paramsOrCallback[\s\S]*?url: \(rootUrl \+ '([^']+)'\)[\s\S]*?method: '(\w+)'[\s\S]*?params,\n(?:\s*mediaUrl: \(rootUrl \+ '([^']+)'\)[^\n]*\n)?\s*requiredParams: \[([^\]]*)\],\n\s*pathParams: \[([^\]]*)\]/g;
    for (const mm of body.matchAll(methodRe)) {
      const list = (s) => s.split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean);
      methods.push({
        resourceClass: cm[1],
        name: mm[1],
        path: mm[2],
        httpMethod: mm[3],
        mediaPath: mm[4] ?? null,
        required: list(mm[5]),
        pathParams: list(mm[6]),
      });
    }
  }
  return methods;
}

/** Map a TS type from the SDK typings to a Zod expression. */
function zodFor(type, schemaPrefix) {
  let t = type.replace(/\s*\|\s*null$/, "").trim();
  const nullable = type.endsWith("| null");
  let expr;
  let m;
  if (t === "string") expr = "z.string()";
  else if (t === "number") expr = "z.number()";
  else if (t === "boolean") expr = "z.boolean()";
  else if (t === "string[]") expr = "z.array(z.string())";
  else if (t === "number[]") expr = "z.array(z.number())";
  else if (t === "any" || t === "unknown") expr = "z.unknown()";
  else if (t === "{}") expr = "z.looseObject({})";
  else if (t === "any[]" || t === "unknown[]") expr = "z.array(z.unknown())";
  else if ((m = t.match(/^Schema\$(\w+)$/))) expr = `z.lazy(() => ${schemaPrefix}${m[1]}Schema)`;
  else if ((m = t.match(/^Schema\$(\w+)\[\]$/))) expr = `z.array(z.lazy(() => ${schemaPrefix}${m[1]}Schema))`;
  else if ((m = t.match(/^\{\s*\[key: string\]: Schema\$(\w+);?\s*\}$/)))
    expr = `z.record(z.string(), z.lazy(() => ${schemaPrefix}${m[1]}Schema))`;
  else if ((m = t.match(/^\{\s*\[key: string\]: string;?\s*\}$/))) expr = "z.record(z.string(), z.string())";
  else if ((m = t.match(/^\{\s*\[key: string\]: any;?\s*\}$/))) expr = "z.record(z.string(), z.unknown())";
  else if (/^any\[\]\[\]$/.test(t)) expr = "z.array(z.array(z.unknown()))";
  else if ((m = t.match(/^\{ ((?:[\w$]+\??: [^;{}]+; )+)\}$/))) {
    const props = [...m[1].matchAll(/([\w$]+)(\?)?: ([^;]+);/g)].map(
      ([, k, opt, ft]) => `${JSON.stringify(k)}: ${zodFor(ft, schemaPrefix)}${opt ? ".optional()" : ""}`,
    );
    expr = `z.looseObject({ ${props.join(", ")} })`;
  }
  else throw new Error(`Unhandled type: ${type}`);
  return nullable ? `${expr}.nullable()` : expr;
}

const docLine = (doc) => (doc ? `  /** ${doc.replace(/\*\//g, "*\\/").slice(0, 400)} */\n` : "");

function generate(api) {
  const dir = dirname(require.resolve(`${api.pkg}/package.json`));
  const dts = readFileSync(join(dir, "build", `${api.file}.d.ts`), "utf8");
  const js = readFileSync(join(dir, "build", `${api.file}.js`), "utf8");
  const { interfaces, responses } = parseDts(dts);
  const methods = parseJs(js);
  const P = api.prefix;

  // Resource property names on the API object (e.g. liveBroadcasts: Resource$Livebroadcasts).
  const resourceProps = new Map();
  const apiClass = dts.match(/class Youtube(?:analytics)? \{([\s\S]*?)\n {4}\}/i);
  for (const m of (apiClass?.[1] ?? "").matchAll(/\n {8}(\w+): (Resource\$\w+);/g)) resourceProps.set(m[2], m[1]);

  const out = [];
  out.push(`/* eslint-disable */
// THIS FILE IS GENERATED by scripts/generate-google.mjs from ${api.pkg}
// (${api.ns}). Do not edit by hand — re-run the generator after upgrading the SDK.
import { z } from "zod";
import { MediaSourceSchema } from "../common/media";
`);

  // ---- resource schemas (Schema$*) ----
  out.push(`// ============ Resource schemas (Schema$*) ============\n// All fields are optional/nullable in Google's discovery documents; unknown fields are preserved.\n`);
  for (const [name, fields] of interfaces) {
    if (!name.startsWith("Schema$")) continue;
    const short = name.slice("Schema$".length);
    const body = fields
      .map((f) => `${docLine(f.doc)}  ${JSON.stringify(f.name)}: ${zodFor(f.type, P)}${f.optional ? ".optional()" : ""},`)
      .join("\n");
    out.push(`export const ${P}${short}Schema = z.looseObject({\n${body}\n});\nexport type ${P}${short} = z.infer<typeof ${P}${short}Schema>;\n`);
  }

  // ---- method params ----
  const endpoints = [];
  const classMethods = [];
  out.push(`\n// ============ Method parameters ============\n`);
  for (const method of methods) {
    const resourceProp = resourceProps.get(method.resourceClass);
    if (!resourceProp) continue;
    const id = `${resourceProp}.${method.name}`;
    if (api.skip.includes(id)) continue;
    const paramsName = `Params$${method.resourceClass}$${method.name[0].toUpperCase()}${method.name.slice(1).toLowerCase()}`;
    const fields = interfaces.get(paramsName);
    if (!fields) throw new Error(`No params interface for ${id}`);
    const noun = api.nouns[resourceProp] ?? pascal(resourceProp);
    const verb = VERBS[method.name] ?? method.name;
    const methodName = `${verb}${noun}`;
    const schemaName = `${P}${pascal(resourceProp)}${pascal(method.name)}InputSchema`;
    const typeName = `${P}${pascal(resourceProp)}${pascal(method.name)}Input`;
    const lines = [];
    let hasMedia = false;
    for (const f of fields) {
      if (f.name === "media") {
        hasMedia = true;
        const req = api.mediaRequired.includes(id);
        lines.push(`  /** Upload body (streamed). */\n  media: MediaSourceSchema${req ? "" : ".optional()"},`);
        continue;
      }
      const required = method.required.includes(f.name);
      let expr = zodFor(f.type, P);
      if (expr === "z.array(z.string())" && required) expr = "z.array(z.string()).min(1)";
      lines.push(`${docLine(f.doc)}  ${JSON.stringify(f.name)}: ${expr}${required ? "" : ".optional()"},`);
    }
    if (method.mediaPath && !hasMedia) lines.push(`  media: MediaSourceSchema.optional(),`);
    lines.push(`  /** Partial response selector (standard parameter). */\n  fields: z.string().optional(),`);
    out.push(`export const ${schemaName} = z.object({\n${lines.join("\n")}\n});\nexport type ${typeName} = z.input<typeof ${schemaName}>;\n`);

    const responseType = responses.get(paramsName) ?? "void";
    const respSchema =
      responseType === "void" ? null : responseType.startsWith("Schema$") ? `${P}${responseType.slice(7)}Schema` : null;
    const httpPath = `${method.httpMethod} ${method.path}`;
    endpoints.push({ id, methodName, http: httpPath, upload: method.mediaPath, required: method.required, response: responseType });
    classMethods.push({ id, methodName, schemaName, typeName, respSchema, resourceProp, sdkMethod: method.name, httpPath, hasMedia: hasMedia || Boolean(method.mediaPath), required: method.required, mediaPath: method.mediaPath });
  }

  writeFileSync(join(root, api.outDir, "model.generated.ts"), out.join("\n"));

  // ---- endpoints table ----
  const ep = `// THIS FILE IS GENERATED by scripts/generate-google.mjs — do not edit.
/** Every ${api.ns} method exposed by the provider class, with its HTTP route and SDK method. */
export const ${P}Endpoints = {
${endpoints
  .map(
    (e) =>
      `  ${JSON.stringify(e.methodName)}: { sdk: ${JSON.stringify(e.id)}, http: ${JSON.stringify(e.http)}, upload: ${JSON.stringify(e.upload)}, requiredParams: ${JSON.stringify(e.required)}, response: ${JSON.stringify(e.response)} },`,
  )
  .join("\n")}
} as const;
export type ${P}Operation = keyof typeof ${P}Endpoints;
`;
  writeFileSync(join(root, api.outDir, "endpoints.ts"), ep);

  // ---- class methods (between markers) ----
  const classPath = join(root, api.outDir, api.classFile);
  const cls = readFileSync(classPath, "utf8");
  const generated = classMethods
    .map((m) => {
      const ret = m.respSchema ? `M.${m.respSchema.replace(/Schema$/, "")}` : "void";
      const call = m.hasMedia
        ? `const { media, ...params } = this.validate(M.${m.schemaName}, input, ${JSON.stringify(m.id)});\n    const body = media ? await this.mediaBody(media) : undefined;\n    return this.call(${JSON.stringify(m.id)}, ${m.respSchema ? `M.${m.respSchema}` : "null"}, (sdk, options) => sdk.${m.resourceProp}.${m.sdkMethod}({ ...params, ...(body ? { media: body } : {}) }, options));`
        : `const params = this.validate(M.${m.schemaName}, input, ${JSON.stringify(m.id)});\n    return this.call(${JSON.stringify(m.id)}, ${m.respSchema ? `M.${m.respSchema}` : "null"}, (sdk, options) => sdk.${m.resourceProp}.${m.sdkMethod}(params, options));`;
      const req = m.required.length ? ` Required: ${m.required.join(", ")}.` : "";
      const up = m.mediaPath ? ` Upload: POST ${m.mediaPath}.` : "";
      return `  /** ${m.httpPath} — SDK \`${m.id}\`.${req}${up} */\n  async ${m.methodName}(input: M.${m.typeName}): Promise<${ret}> {\n    ${call}\n  }`;
    })
    .join("\n\n");
  const start = "  // <generated-methods>";
  const end = "  // </generated-methods>";
  const a = cls.indexOf(start);
  const b = cls.indexOf(end);
  if (a === -1 || b === -1) throw new Error(`Markers missing in ${api.classFile}`);
  writeFileSync(classPath, `${cls.slice(0, a + start.length)}\n  // Generated by scripts/generate-google.mjs — do not edit between the markers.\n\n${generated}\n\n${cls.slice(b)}`);
  console.log(`${api.pkg}: ${classMethods.length} methods, ${[...interfaces.keys()].filter((k) => k.startsWith("Schema$")).length} schemas`);
}

for (const api of APIS) generate(api);
