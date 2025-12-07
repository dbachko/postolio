import type { HttpRequest } from '../http/http';
import type { SavedReply, CreateSavedReplyInput, UpdateSavedReplyInput } from './types';

export class SavedRepliesClient {
  constructor(private request: HttpRequest) {}

  /**
   * List all saved replies for a brand
   */
  listSavedReplies(brandId: string): Promise<{ savedReplies: SavedReply[] }> {
    return this.request(`/api/brands/${brandId}/saved-replies`);
  }

  /**
   * Create a new saved reply
   */
  createSavedReply(
    brandId: string,
    data: CreateSavedReplyInput
  ): Promise<{ savedReply: SavedReply }> {
    return this.request(`/api/brands/${brandId}/saved-replies`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing saved reply
   */
  updateSavedReply(
    brandId: string,
    replyId: string,
    data: UpdateSavedReplyInput
  ): Promise<{ savedReply: SavedReply }> {
    return this.request(`/api/brands/${brandId}/saved-replies/${replyId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a saved reply
   */
  deleteSavedReply(brandId: string, replyId: string): Promise<void> {
    return this.request(`/api/brands/${brandId}/saved-replies/${replyId}`, {
      method: 'DELETE',
    });
  }
}
