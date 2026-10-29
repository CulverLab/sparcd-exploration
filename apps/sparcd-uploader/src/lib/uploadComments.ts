export type RequiredUploadComments = {
  mountainRange: string;
  dateCollected: string;
  previewUploadDate?: string;
};

export function uploadCommentDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatUploadComments(input: {
  required?: RequiredUploadComments;
  siteName: string;
  siteId: string;
  imageCount: number; // "images" is the agreed shorthand for all valid uploaded files, including MP4s.
  uploadDate: Date;
  comments: string;
}): string {
  if (!input.required) return input.comments;
  const uploaded = input.required.previewUploadDate ?? uploadCommentDate(input.uploadDate);
  const prefix = `${input.required.mountainRange.trim()} - ${input.siteName} - ${input.siteId} - ${input.imageCount} ${input.imageCount === 1 ? 'image' : 'images'} - uploaded ${uploaded} - collected ${input.required.dateCollected}`;
  return input.comments.trim() ? `${prefix} - ${input.comments}` : prefix;
}
