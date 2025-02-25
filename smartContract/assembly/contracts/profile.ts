import {
  Address,
  balance,
  call,
  callee,
  caller,
  Context,
  createEvent,
  generateEvent,
  isAddressEoa,
  Storage,
  timestamp,
  transferCoins,
  transferredCoins,
} from '@massalabs/massa-as-sdk';
import { Args, bytesToString } from '@massalabs/as-types';
import { _setOwner, OWNER_KEY } from './utils/ownership-internal';
import { onlyOwner, ownerAddress, setOwner } from './utils/ownership';
import { Profile } from '../structs/profile';
import {
  _builduserFollowsKey,
  _buildUserRepostKey,
  COMMENT_ID_KEY,
  commentsMap,
  FOLLOW_ID_KEY,
  followsMap,
  LIKE_ID_KEY,
  likesMap,
  POST_ID_KEY,
  postMap,
  repostsMap,
  usersFollowsMap,
  PROFILE_OWNERS,
  FACTORY_CONTRACT,
  START_POST_ID,
  START_LIKE_ID,
  START_COMMENT_ID,
  START_FOLLOW_ID,
} from './storage';
import { Post } from '../structs/post';
import { Comment } from '../structs/comment';
import { Like } from '../structs/like';
import { Follow } from '../structs/follow';
import { Repost } from '../structs/repost';

/**
 * Smart contract constructor - Initializes the contract at deployment.
 * Ensures the contract is only deployed once.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the user address.
 */
export function constructor(binaryArgs: StaticArray<u8>): void {
  if (!Context.isDeployingContract()) {
    return;
  }

  const args = new Args(binaryArgs);
  const userAddress = args.nextString().expect('User address required');

  _setOwner(userAddress);

  Storage.set(FACTORY_CONTRACT, caller().toString());
  Storage.set(POST_ID_KEY, START_POST_ID.toString());
  Storage.set(LIKE_ID_KEY, START_LIKE_ID.toString());
  Storage.set(COMMENT_ID_KEY, START_COMMENT_ID.toString());
  Storage.set(FOLLOW_ID_KEY, START_FOLLOW_ID.toString());

  generateEvent(createEvent('ContractDeployed', [userAddress]));
}

/**
 * Handles incoming deposits to the contract.
 *
 * @param {StaticArray<u8>} _ - Unused parameter.
 */
export function receiveCoins(_: StaticArray<u8>): void {
  generateEvent(
    createEvent('Deposit to the profile contract', [
      caller().toString(),
      transferredCoins().toString(),
    ]),
  );
}

/************ADMIN FEATURES************/

/**
 * Allows the contract owner to withdraw a specified amount to a given address.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing withdrawal details.
 */
export function claim(binaryArgs: StaticArray<u8>): void {
  assert(
    caller().toString() == Storage.get(OWNER_KEY),
    'Only owner can execute the claim',
  );

  const args = new Args(binaryArgs);
  const claimAmount = args
    .nextU64()
    .expect('claimAmount argument is missing or invalid');
  const to = args.nextString().expect('to argument is missing or invalid');
  assert(balance() > claimAmount, "This contract doesn't have enough balance");
  if (isAddressEoa(to)) {
    transferCoins(new Address(to), claimAmount);
  } else {
    call(new Address(to), 'receiveCoins', new Args(), claimAmount);
  }

  generateEvent(
    createEvent('Claim from the profile contract', [
      to,
      claimAmount.toString(),
    ]),
  );
}

/**
 * Transfers ownership of the contract to a new owner.
 * Updates the profile contract to reflect the new owner.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the new owner address.
 */
export function transferOwnership(binaryArgs: StaticArray<u8>): void {
  onlyOwner();

  const args = new Args(binaryArgs);
  const oldOwner = bytesToString(ownerAddress(new Args().serialize()));
  const newOwner = args.nextString().unwrap();
  const profile = new Args(
    call(
      new Address(Storage.get(FACTORY_CONTRACT)),
      'getProfile',
      new Args().add(oldOwner),
      0,
    ),
  )
    .nextSerializable<Profile>()
    .unwrap();
  call(
    new Address(Storage.get(FACTORY_CONTRACT)),
    'updateProfile',
    new Args()
      .add(oldOwner)
      .add(newOwner)
      .add(profile.firstName)
      .add(profile.lastName)
      .add(profile.avatar)
      .add(profile.bio),
    0,
  );
  setOwner(new Args().add(newOwner).serialize());
  generateEvent(createEvent('TransferOwnership', [oldOwner, newOwner]));
}

/**
 * Allows the contract owner to follow a profile.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the profile contract address.
 */
export function followProfile(binaryArgs: StaticArray<u8>): void {
  onlyOwner();

  const args = new Args(binaryArgs);
  const ProfileContractAddress = args.nextString().unwrap();

  const profileExist = Storage.hasOf(
    new Address(Storage.get(FACTORY_CONTRACT)),
    PROFILE_OWNERS.concat(ProfileContractAddress),
  );

  assert(profileExist, "This contract profile doesn't exist");

  const lastFollowId = u64.parse(Storage.get(FOLLOW_ID_KEY));

  const usersFollowsKey = _builduserFollowsKey(
    callee().toString(),
    ProfileContractAddress,
  );

  const usersFollowsId = usersFollowsMap.get(usersFollowsKey, u64(0));

  const isFollowing = usersFollowsId > u64(0);

  assert(!isFollowing, 'User is already following this profile.');

  const follow = new Follow(
    lastFollowId,
    callee(),
    new Address(ProfileContractAddress),
    timestamp(),
  );

  call(
    new Address(ProfileContractAddress),
    '_addFollowing',
    new Args().add(follow),
    0,
  );

  followsMap.set(lastFollowId, follow);

  usersFollowsMap.set(usersFollowsKey, lastFollowId);

  Storage.set(FOLLOW_ID_KEY, (lastFollowId + 1).toString());

  generateEvent(
    createEvent('FollowProfile', [
      follow.follower.toString(),
      follow.followed.toString(),
      follow.createdAt.toString(),
    ]),
  );
}

/**
 * Allows the contract owner to unfollow a profile.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the profile contract address.
 */
export function unfollowProfile(binaryArgs: StaticArray<u8>): void {
  onlyOwner();
  const args = new Args(binaryArgs);
  const ProfileContractAddress = args.nextString().unwrap();

  const profileExist = Storage.hasOf(
    new Address(Storage.get(FACTORY_CONTRACT)),
    PROFILE_OWNERS.concat(ProfileContractAddress),
  );

  assert(profileExist, "This contract profile doesn't exist");

  const usersFollowsKey = _builduserFollowsKey(
    callee().toString(),
    ProfileContractAddress,
  );

  const userFollowsId = usersFollowsMap.get(usersFollowsKey, u64(0));

  const isFollowing = userFollowsId > u64(0);

  assert(isFollowing, 'User is not following this profile.');

  const follow = followsMap.getSome(userFollowsId);

  call(follow.followed, '_removeFollowing', new Args().add(follow), 0);

  usersFollowsMap.delete(usersFollowsKey);
  followsMap.delete(userFollowsId);

  generateEvent(
    createEvent('UnfollowProfile', [
      callee().toString(),
      ProfileContractAddress,
      timestamp().toString(),
    ]),
  );
}

/**
 * Internal function to register a follower in the profile contract.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the follow object.
 */
export function _addFollowing(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const follow = args.nextSerializable<Follow>().unwrap();
  assert(
    caller() == follow.follower,
    'Caller does not have permission to execute this function',
  );

  const lastFollowId = u64.parse(Storage.get(FOLLOW_ID_KEY));

  // add the follow entry to the map
  followsMap.set(lastFollowId, follow);

  const usersFollowsKey = _builduserFollowsKey(
    follow.follower.toString(),
    follow.followed.toString(),
  );

  usersFollowsMap.set(usersFollowsKey, lastFollowId);

  Storage.set(FOLLOW_ID_KEY, (lastFollowId + 1).toString());

  generateEvent(
    createEvent('FollowingProfile', [
      follow.follower.toString(),
      follow.followed.toString(),
      follow.createdAt.toString(),
    ]),
  );
}

/**
 * Internal function to remove a follower from the profile contract.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the follow object.
 */
export function _removeFollowing(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const follow = args.nextSerializable<Follow>().unwrap();

  assert(
    caller() == follow.follower,
    'Caller does not have permission to execute this function',
  );

  const usersFollowsKey = _builduserFollowsKey(
    follow.follower.toString(),
    follow.followed.toString(),
  );

  const userFollowsId = usersFollowsMap.get(usersFollowsKey, u64(0));

  usersFollowsMap.delete(usersFollowsKey);
  followsMap.delete(userFollowsId);

  generateEvent(
    createEvent('removeFollowing', [
      follow.follower.toString(),
      follow.followed.toString(),
      timestamp().toString(),
    ]),
  );
}

/**
 * Retrieves a paginated list of followers for the calling profile.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the pagination selection part.
 * @returns {StaticArray<u8>} - Serialized list of followers.
 */
export function getAllUserFollowers(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const selectionPart = args.nextU64().unwrap();
  assert(selectionPart > 0, 'selectionPart should be greater than 0');

  let followers: Follow[] = [];

  for (
    let i = u64(START_FOLLOW_ID) + (selectionPart - 1) * 10;
    i <= selectionPart * 10;
    i++
  ) {
    const follow = followsMap.get(i, new Follow());
    if (follow.followed.toString() == callee().toString()) {
      followers.push(follow);
    }
  }

  return new Args().addSerializableObjectArray<Follow>(followers).serialize();
}

/**
 * Retrieves a paginated list of profiles the calling user is following.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the pagination selection part.
 * @returns {StaticArray<u8>} - Serialized list of followings.
 */
export function getAllUserFollowings(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const selectionPart = args.nextU64().unwrap();
  assert(selectionPart > 0, 'selectionPart should be greater than 0');

  let followings: Follow[] = [];

  for (
    let i = u64(START_FOLLOW_ID) + (selectionPart - 1) * 10;
    i <= selectionPart * 10;
    i++
  ) {
    const follow = followsMap.get(i, new Follow());
    if (follow.follower.toString() == callee().toString()) {
      followings.push(follow);
    }
  }

  return new Args().addSerializableObjectArray<Follow>(followings).serialize();
}

/**
 * Creates a new post.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing post details.
 */
export function createPost(binaryArgs: StaticArray<u8>): void {
  onlyOwner();
  const args = new Args(binaryArgs);

  const title = args.nextString().unwrap();
  const text = args.nextString().unwrap();
  const image = args.nextString().unwrap();
  const createdAt = timestamp();

  const postId = u64.parse(Storage.get(POST_ID_KEY));

  const post = new Post(postId, caller(), title, text, image, createdAt);

  postMap.set(postId.toString(), post);

  Storage.set(POST_ID_KEY, (postId + 1).toString());

  generateEvent(
    createEvent('CreatePost', [post.id.toString(), post.author.toString()]),
  );
}

/**
 * Updates an existing post.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing post ID and new content.
 */
export function updatePost(binaryArgs: StaticArray<u8>): void {
  onlyOwner();
  const args = new Args(binaryArgs);

  const postId = args.nextU64().unwrap();
  const title = args.nextString().unwrap();
  const text = args.nextString().unwrap();
  const image = args.nextString().unwrap();

  assert(postMap.contains(postId.toString()), 'Post does not exist');

  let post = postMap.get(postId.toString(), new Post());

  assert(post.id == postId, 'Post does not exist');

  post.title = title;
  post.text = text;
  post.image = image;

  postMap.set(postId.toString(), post);

  generateEvent(createEvent('UpdatePost', [postId.toString()]));
}

/**
 * Reposts an existing post.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the original post ID.
 */
export function repostPost(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const originalPostId = args.nextU64().unwrap();

  assert(
    postMap.contains(originalPostId.toString()),
    'Original post not found',
  );

  const profile = new Args(
    call(
      new Address(Storage.get(FACTORY_CONTRACT)),
      'getProfile',
      new Args().add(caller().toString()),
      0,
    ),
  )
    .nextSerializable<Profile>()
    .unwrap();

  const repost = new Repost(0, originalPostId, callee());

  call(profile.profileContract, '_addRepost', new Args().add(repost), 0);

  generateEvent(
    createEvent('RepostPost', [
      originalPostId.toString(),
      profile.profileContract.toString(),
    ]),
  );
}

/**
 * Adds a repost entry to the repost map.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the repost details.
 */
export function _addRepost(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const repost = args.nextSerializable<Repost>().unwrap();

  assert(
    caller().toString() == repost.authorProfileContract.toString(),
    'Caller does not have permission to execute this function',
  );

  const postId = u64.parse(Storage.get(POST_ID_KEY));

  repost.id = postId;
  repostsMap.set(postId.toString(), repost);

  Storage.set(POST_ID_KEY, (postId + 1).toString());

  generateEvent(
    createEvent('AddRepost', [
      repost.id.toString(),
      repost.originalPostId.toString(),
      repost.authorProfileContract.toString(),
    ]),
  );
}

/**
 * Deletes a post.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the post ID.
 */
export function deletePost(binaryArgs: StaticArray<u8>): void {
  onlyOwner();
  const args = new Args(binaryArgs);
  const postId = args.nextU64().unwrap();

  assert(
    postMap.contains(postId.toString()) ||
      repostsMap.contains(postId.toString()),
    'Post not found',
  );

  if (postMap.contains(postId.toString())) {
    postMap.delete(postId.toString());
  } else if (repostsMap.contains(postId.toString())) {
    repostsMap.delete(postId.toString());
  }

  generateEvent(
    createEvent('DeletePost', [postId.toString(), callee().toString()]),
  );
}

/**
 * Retrieves a paginated list of posts.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the pagination selection part.
 * @returns {StaticArray<u8>} - Serialized list of posts.
 */
export function getPosts(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const selectionPart = args.nextU64().unwrap();
  assert(selectionPart > 0, 'selectionPart should be greater than 0');
  let posts: Post[] = [];

  for (
    let i = u64(START_POST_ID) + (selectionPart - 1) * 10;
    i <= selectionPart * 10;
    i++
  ) {
    if (postMap.contains(i.toString())) {
      const post = postMap.get(i.toString(), new Post());
      posts.push(post);
    } else if (repostsMap.contains(i.toString())) {
      const repost = repostsMap.get(i.toString(), new Repost());
      const post = new Args(
        call(
          repost.authorProfileContract,
          'getPost',
          new Args().add(repost.originalPostId),
          0,
        ),
      )
        .nextSerializable<Post>()
        .unwrap();
      posts.push(post);
    }
  }

  return new Args().addSerializableObjectArray<Post>(posts).serialize();
}

/**
 * Retrieves a single post by ID.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the post ID.
 * @returns {StaticArray<u8>} - Serialized post.
 */
export function getPost(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const lastPostId = u64.parse(Storage.get(POST_ID_KEY));

  const args = new Args(binaryArgs);
  const postId = args.nextU64().unwrap();

  assert(postId < lastPostId, 'Post not found');

  let post = new Post();
  if (postMap.contains(postId.toString())) {
    post = postMap.get(postId.toString(), new Post());
  } else if (repostsMap.contains(postId.toString())) {
    const repost = repostsMap.get(postId.toString(), new Repost());
    post = new Args(
      call(
        repost.authorProfileContract,
        'getPost',
        new Args().add(repost.originalPostId),
        0,
      ),
    )
      .nextSerializable<Post>()
      .unwrap();
  }
  return post.serialize();
}

/**
 * Function to like a post.
 * Ensures the user hasn't already liked the post before adding a new like.
 */
export function likePost(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const postId = args.nextU64().unwrap();
  const userAddress = caller().toString();

  const lastLikeId = u64.parse(Storage.get(LIKE_ID_KEY));

  assert(
    postMap.contains(postId.toString()) ||
      repostsMap.contains(postId.toString()),
    'Post not found',
  );

  let alreadyLiked = false;

  for (let i = u64(START_LIKE_ID); i < lastLikeId; i++) {
    const like = likesMap.get(i, new Like());

    if (like.userAddress.toString() == userAddress && like.postId == postId) {
      alreadyLiked = true;
      break;
    }
  }

  assert(!alreadyLiked, 'User has already liked this post');

  const like = new Like(
    lastLikeId,
    new Address(userAddress),
    postId,
    timestamp(),
  );

  likesMap.set(lastLikeId, like);

  Storage.set(LIKE_ID_KEY, (lastLikeId + 1).toString());

  generateEvent(createEvent('LikePost', [userAddress, postId.toString()]));
}

/**
 * Function to unlike a post.
 * Ensures the user has previously liked the post before allowing them to unlike it.
 */
export function unlikePost(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);

  const postId = args.nextU64().unwrap();
  const userAddress = caller().toString();

  const lastLikeId = u64.parse(Storage.get(LIKE_ID_KEY));

  assert(
    postMap.contains(postId.toString()) ||
      repostsMap.contains(postId.toString()),
    'Post not found',
  );

  let alreadyLiked = false;

  let likeId = u64(0);

  for (let i = u64(START_LIKE_ID); i < lastLikeId; i++) {
    const like = likesMap.get(i, new Like());

    if (like.userAddress.toString() == userAddress && like.postId == postId) {
      likeId = i;
      alreadyLiked = true;
      break;
    }
  }

  assert(alreadyLiked, 'User has not liked this post');

  likesMap.delete(likeId);

  generateEvent(
    createEvent('UnlikePost', [
      likeId.toString(),
      userAddress,
      postId.toString(),
    ]),
  );
}

/**
 * Function to get users who liked a specific post.
 * Retrieves users in paginated format using selectionPart.
 */
export function getPostLikedUsers(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const selectionPart = args.nextU64().unwrap();
  const postId = args.nextU64().unwrap();
  assert(selectionPart > 0, 'selectionPart should be greater than 0');

  let likedUsers: String[] = [];

  for (
    let i = u64(START_LIKE_ID) + (selectionPart - 1) * 10;
    i <= selectionPart * 10;
    i++
  ) {
    const like = likesMap.get(i, new Like());

    if (like.postId == postId) {
      likedUsers.push(like.userAddress.toString());
    }
  }

  return new Args().add(likedUsers).serialize();
}

/**
 * Function to add a comment to a post.
 * Supports both top-level comments and replies to existing comments.
 */
export function addPostComment(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const postId = args.nextU64().unwrap();
  const text = args.nextString().unwrap();
  const parentCommentIdOpt = args.nextU64(); // Optional parent comment ID

  assert(
    postMap.contains(postId.toString()) ||
      repostsMap.contains(postId.toString()),
    'Post not found',
  );

  const commentId = u64.parse(Storage.get(COMMENT_ID_KEY));

  let parentId: u64 = u64(0);

  if (!parentCommentIdOpt.isErr()) {
    const parentCommentId = parentCommentIdOpt.unwrap();
    assert(commentsMap.contains(parentCommentId), 'Parent comment not found');
    parentId = parentCommentId;
  }

  const comment = new Comment(
    commentId,
    postId,
    caller(),
    text,
    timestamp(),
    parentId,
  );

  commentsMap.set(commentId, comment);

  Storage.set(COMMENT_ID_KEY, (commentId + 1).toString());

  generateEvent(
    createEvent('AddComment', [
      postId.toString(),
      commentId.toString(),
      caller().toString(),
      parentId > u64(0) ? parentId.toString() : 'null',
    ]),
  );
}

/**
 * Function to retrieve paginated comments for a specific post.
 * Uses selectionPart to fetch a portion of comments.
 */
export function getPostComments(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const selectionPart = args.nextU64().unwrap();
  const postId = args.nextU64().unwrap();
  assert(selectionPart > 0, 'selectionPart should be greater than 0');

  assert(
    postMap.contains(postId.toString()) ||
      repostsMap.contains(postId.toString()),
    'Post not found',
  );

  let commentsArray: Comment[] = [];

  for (let i = u64(0) + (selectionPart - 1) * 10; i < selectionPart * 10; i++) {
    const commentId = i;
    const comment = commentsMap.get(commentId, new Comment());
    if (comment.postId === postId) {
      commentsArray.push(comment);
    }
  }

  return new Args()
    .addSerializableObjectArray<Comment>(commentsArray)
    .serialize();
}

/**
 * Function to get replies for a specific comment.
 * Supports pagination using selectionPart.
 */
export function getCommentReplies(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const selectionPart = args.nextU64().unwrap();
  const commentId = args.nextU64().unwrap();
  assert(selectionPart > 0, 'selectionPart should be greater than 0');

  assert(commentsMap.contains(commentId), 'Comment not found');

  const lastCommentId = u64.parse(Storage.get(COMMENT_ID_KEY));
  let repliesArray: Comment[] = [];

  for (let i = u64(0) + (selectionPart - 1) * 10; i < selectionPart * 10; i++) {
    const comment = commentsMap.get(i, new Comment());
    if (comment.parentId === commentId) {
      repliesArray.push(comment);
    }
  }

  return new Args()
    .addSerializableObjectArray<Comment>(repliesArray)
    .serialize();
}

/**
 * Function to remove a comment.
 * Ensures only the original commenter can delete their comment.
 */
export function removeComment(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const commentId = args.nextU64().unwrap();

  assert(commentsMap.contains(commentId), 'Comment not found');

  const comment = commentsMap.get(commentId, new Comment());

  assert(
    comment.commenter.toString() == caller().toString(),
    'Caller has no permission to delete this comment',
  );

  commentsMap.delete(commentId);

  generateEvent(createEvent('commentRemoved', [commentId.toString()]));
}

/**
 * Function to delete a user's account.
 * Can only be executed by the contract owner.
 * Clears all stored data and transfers remaining balance.
 */
export function deleteAccount(): void {
  onlyOwner();
  const owner = bytesToString(ownerAddress(new Args().serialize()));
  const keys = Storage.getKeys();

  call(
    new Address(Storage.get(FACTORY_CONTRACT)),
    'deleteProfile',
    new Args().add(owner),
    0,
  );

  for (let i = 0; i <= keys.length; i++) {
    Storage.del(keys[i]);
  }

  transferCoins(new Address(owner), balance());

  generateEvent(createEvent('AccountDeleted', [callee().toString(), owner]));
}
