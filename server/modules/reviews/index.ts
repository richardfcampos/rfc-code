// reviewsRoutes: used by the server entrypoint to mount the Review Center HTTP API at `/api/reviews`.
// configureReviewsRuntime: called once at boot with the provider runtimes, so a
// review comment can be routed into the author's session; it also installs the
// task-stage subscription that opens a review when a card reaches Review.
export { configureReviewsRuntime, reviewsRoutes, reviewsService } from './reviews.module.js';

export type { ReviewsService } from './reviews.service.js';
export {
  ReviewFileNotInDiffError,
  ReviewNotFoundError,
  ReviewStateError,
  ReviewTaskUnresolvedError,
  ReviewValidationError,
  ReviewWorktreeMissingError,
} from './reviews.errors.js';
export { broadcastReviewUpdate } from './review-update-broadcast.js';
export type { ReviewUpdateAction } from './review-update-broadcast.js';
