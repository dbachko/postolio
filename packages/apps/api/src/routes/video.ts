/**
 * Video Upload Routes
 * Handles multipart video uploads to S3
 */

import { FastifyPluginAsync } from 'fastify';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID, randomBytes } from 'crypto';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

const ASSETS_BUCKET = process.env.ASSETS_BUCKET || 'postolio-assets-dev';
const ASSETS_CDN_DOMAIN = process.env.ASSETS_CDN_DOMAIN;
const MAX_VIDEO_SIZE = 300 * 1024 * 1024; // 300MB (Instagram limit)
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

const videoRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Initiate multipart upload
   * Returns uploadId and presigned URLs for each part
   */
  fastify.post<{
    Body: {
      fileName: string;
      fileSize: number;
      contentType: string;
      brandId: string;
    };
  }>('/upload-url', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { fileName, fileSize, contentType, brandId } = request.body;

      // Validate file size
      if (fileSize > MAX_VIDEO_SIZE) {
        return reply.code(400).send({
          error: `File too large. Maximum size is ${MAX_VIDEO_SIZE / (1024 * 1024)}MB`,
        });
      }

      // Validate content type
      if (!contentType.startsWith('video/')) {
        return reply.code(400).send({
          error: 'Invalid content type. Must be a video file.',
        });
      }

      // Verify user owns the brand
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId },
      });

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      // Generate unique key for video
      const contentId = randomUUID();
      const hash = randomBytes(4).toString('hex');
      const ext = fileName.split('.').pop() || 'mp4';
      const key = `videos/${brandId}/${contentId}-${hash}.${ext}`;

      // Calculate number of parts
      const partCount = Math.ceil(fileSize / CHUNK_SIZE);

      // Create multipart upload
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: ASSETS_BUCKET,
        Key: key,
        ContentType: contentType,
      });

      const { UploadId } = await s3Client.send(createCommand);

      if (!UploadId) {
        return reply.code(500).send({ error: 'Failed to initiate upload' });
      }

      // Generate presigned URLs for each part
      const presignedUrls = await Promise.all(
        Array.from({ length: partCount }, async (_, i) => {
          const partNumber = i + 1;
          const command = new UploadPartCommand({
            Bucket: ASSETS_BUCKET,
            Key: key,
            UploadId,
            PartNumber: partNumber,
          });

          const url = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // 1 hour
          });

          return { partNumber, url };
        })
      );

      return reply.send({
        uploadId: UploadId,
        key,
        presignedUrls,
        partCount,
      });
    } catch (error) {
      fastify.log.error({ error }, 'Video upload initiation error');
      return reply.code(500).send({
        error: 'Failed to initiate video upload',
      });
    }
  });

  /**
   * Complete multipart upload
   * Finalizes the upload and returns CDN URL
   */
  fastify.post<{
    Body: {
      uploadId: string;
      key: string;
      parts: Array<{ ETag: string; PartNumber: number }>;
    };
  }>('/upload-complete', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const { uploadId, key, parts } = request.body;

      if (!uploadId || !key || !parts || parts.length === 0) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      // Complete the multipart upload
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: ASSETS_BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.PartNumber - b.PartNumber)
            .map((part) => ({
              ETag: part.ETag,
              PartNumber: part.PartNumber,
            })),
        },
      });

      await s3Client.send(completeCommand);

      // Generate CDN URL
      const cdnUrl = ASSETS_CDN_DOMAIN
        ? `https://${ASSETS_CDN_DOMAIN}/${key}`
        : `https://${ASSETS_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

      return reply.send({
        success: true,
        cdnUrl,
        key,
      });
    } catch (error) {
      fastify.log.error({ error }, 'Video upload completion error');
      return reply.code(500).send({
        error: 'Failed to complete video upload',
      });
    }
  });

  /**
   * Abort multipart upload
   * Cleans up partial upload
   */
  fastify.post<{
    Body: {
      uploadId: string;
      key: string;
    };
  }>('/upload-abort', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const { uploadId, key } = request.body;

      if (!uploadId || !key) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: ASSETS_BUCKET,
        Key: key,
        UploadId: uploadId,
      });

      await s3Client.send(abortCommand);

      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Video upload abort error');
      return reply.code(500).send({
        error: 'Failed to abort video upload',
      });
    }
  });
};

export default videoRoutes;
