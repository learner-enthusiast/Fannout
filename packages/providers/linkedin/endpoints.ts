import { LINKEDIN_USERINFO_URL } from "./constants";

/**
 * Rest.li 2.0 key encoding: URL-encode everything including the characters
 * Rest.li treats as syntax — `(`, `)`, `,`, `:` and `'` — so composite URNs
 * such as urn:li:comment:(urn:li:activity:1,2) survive as one key.
 */
export function restliEncode(value: string): string {
  return encodeURIComponent(value).replace(/[()',]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `List(a,b)` with each element encoded; the separating commas stay literal. */
export function restliList(values: readonly (string | number)[]): string {
  return `List(${values.map((v) => restliEncode(String(v))).join(",")})`;
}

export const LinkedInEndpoints = {
  userInfo: LINKEDIN_USERINFO_URL,

  posts: "posts",
  post: (postUrn: string) => `posts/${restliEncode(postUrn)}`,

  images: "images",
  image: (imageUrn: string) => `images/${restliEncode(imageUrn)}`,
  videos: "videos",
  video: (videoUrn: string) => `videos/${restliEncode(videoUrn)}`,
  documents: "documents",
  document: (documentUrn: string) => `documents/${restliEncode(documentUrn)}`,

  comments: (target: string) => `socialActions/${restliEncode(target)}/comments`,
  comment: (target: string, commentId: string) =>
    `socialActions/${restliEncode(target)}/comments/${restliEncode(commentId)}`,

  reactions: "reactions",
  reaction: (actor: string, entity: string) =>
    `reactions/(actor:${restliEncode(actor)},entity:${restliEncode(entity)})`,
  reactionsByEntity: (entity: string) => `reactions/(entity:${restliEncode(entity)})`,
  reactionKey: (actor: string, entity: string) =>
    `(actor:${restliEncode(actor)},entity:${restliEncode(entity)})`,

  socialMetadataBatch: "socialMetadata",
  socialMetadata: (urn: string) => `socialMetadata/${restliEncode(urn)}`,

  organizationAcls: "organizationAcls",
  organizations: "organizations",
  organization: (id: number | string) => `organizations/${restliEncode(String(id))}`,
  organizationsLookup: "organizationsLookup",
  networkSize: (organizationUrn: string) => `networkSizes/${restliEncode(organizationUrn)}`,
} as const;
