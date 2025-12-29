-- Inbox v2: speed up webhook lookups (account + media id mappings)

CREATE INDEX "social_accounts_platform_externalPageId_idx"
ON "public"."social_accounts"("platform", "externalPageId");

CREATE INDEX "content_publications_platform_externalPostId_idx"
ON "public"."content_publications"("platform", "externalPostId");
