import {
  createSC,
  call,
  Context,
  Storage,
  generateEvent,
  createEvent,
  getBytecodeOf,
  Address,
  caller,
  balance,
  isAddressEoa,
  transferCoins,
  transferredCoins,
} from '@massalabs/massa-as-sdk';
import { Args } from '@massalabs/as-types';
import { Profile } from '../structs/profile';
import {
  profileMap,
  PROFILE_OWNERS,
  ACCOUNT_TEMPLATE,
  OWNER_KEY,
  USERS,
  ONE_UNIT,
} from './storage';

/**
 * Smart contract constructor - Initializes the contract at deployment.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the profile template address.
 */
export function constructor(binaryArgs: StaticArray<u8>): void {
  assert(
    Context.isDeployingContract(),
    'constructor can only be called at deployment',
  );

  const args = new Args(binaryArgs);
  const addressOfTemplate = args
    .nextString()
    .expect('Profile template address required');
  Storage.set(OWNER_KEY, Context.caller().toString());
  Storage.set(ACCOUNT_TEMPLATE, addressOfTemplate);
  Storage.set(USERS, new Args().add<Array<string>>([]).serialize());

  generateEvent(createEvent('FactoryDeployed', [Context.caller().toString()]));
}

/**
 * Function to handle deposits to the contract.
 *
 * @param {StaticArray<u8>} _ - Unused parameter.
 */
export function receiveCoins(_: StaticArray<u8>): void {
  generateEvent(
    createEvent('Deposit to the accountFactory contract', [
      Context.caller().toString(),
      Context.transferredCoins().toString(),
    ]),
  );
}

/************ADMIN FEATURES************/

/**
 * Allows the contract owner to withdraw a specified amount to a given address.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the amount to withdraw and recipient address.
 */
export function claim(binaryArgs: StaticArray<u8>): void {
  // Ensure only the marketplace owner can call this function
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
    createEvent('Claim from the accountFactory contract', [
      to,
      claimAmount.toString(),
    ]),
  );
}

/**
 * Creates a new profile for a user by deploying a new smart contract instance.
 * Requires a payment of 10 Mas.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing user details.
 */
export function createProfile(binaryArgs: StaticArray<u8>): void {
  assert(
    transferredCoins() >= 10000000000,
    'You need to pay 10 Mas in order to create account',
  );

  assert(
    !profileMap.contains(caller().toString()),
    'This user already have an account',
  );

  const args = new Args(binaryArgs);

  const firstName = args.nextString().expect('First name required');
  const lastName = args.nextString().expect('Last name required');
  const bio = args.nextString().expect('Bio required');
  const photo = args.nextString().expect('Photo required');

  const constructorArgs = new Args().add(caller().toString());
  let profilecontract: StaticArray<u8> = getBytecodeOf(
    new Address(Storage.get(ACCOUNT_TEMPLATE)),
  );
  const newContractAddress = createSC(profilecontract);
  call(newContractAddress, 'constructor', constructorArgs, ONE_UNIT);

  const profile = new Profile(
    newContractAddress,
    caller(),
    firstName,
    lastName,
    photo,
    bio,
  );

  let users = new Args(Storage.get(USERS)).nextStringArray().unwrap();
  users.push(caller().toString());
  profileMap.set(caller().toString(), profile);
  Storage.set(USERS, new Args().add<Array<string>>(users).serialize());
  Storage.set(
    PROFILE_OWNERS.concat(newContractAddress.toString()),
    caller().toString(),
  );

  generateEvent(
    createEvent('NewProfileContractDeployed', [
      newContractAddress.toString(),
      caller().toString(),
    ]),
  );
}

/**
 * Retrieves a user's profile information.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the user's address.
 * @returns {StaticArray<u8>} - Serialized profile data.
 */
export function getProfile(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);

  const userAddress = args.nextString().unwrap();

  const profile = profileMap.getSome(userAddress);

  return profile.serialize();
}

/**
 * Updates an existing user's profile information.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing updated profile details.
 */
export function updateProfile(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const userAddress = args.nextString().unwrap();
  const newUserAddress = args.nextString().unwrap();
  const newFirstName = args.nextString().unwrap();
  const newLastName = args.nextString().unwrap();
  const newAvatar = args.nextString().unwrap();
  const newBio = args.nextString().unwrap();
  const profile = profileMap.getSome(userAddress);

  assert(
    caller().toString() == profile.address.toString() ||
      caller().toString() == profile.profileContract.toString(),
    'Caller does not have permission to update this profile',
  );

  if (caller().toString() == profile.address.toString()) {
    assert(userAddress == newUserAddress, 'Change user address denied');
  }

  if (userAddress != newUserAddress) {
    profileMap.delete(userAddress);
    profile.address = new Address(newUserAddress);
    Storage.set(PROFILE_OWNERS.concat(caller().toString()), newUserAddress);
  }

  profile.firstName = newFirstName;
  profile.lastName = newLastName;
  profile.avatar = newAvatar;
  profile.bio = newBio;

  profileMap.set(newUserAddress.toString(), profile);

  generateEvent(createEvent('UpdateProfile', [userAddress.toString()]));
}

/**
 * Retrieves the profile contract address associated with a user.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the user ID.
 * @returns {StaticArray<u8>} - Serialized profile contract address.
 */
export function getUserProfile(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const userId = args.nextString().expect('Missing userId argument');

  const profile = profileMap.getSome(userId);

  return new Args().add(profile.profileContract).serialize();
}

/**
 * Retrieves the owner of a specific profile contract.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the profile contract address.
 * @returns {StaticArray<u8>} - Serialized owner address.
 */
export function getProfileOwner(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const profileContractAddress = args
    .nextString()
    .expect('Missing profileContractAddress argument');

  return new Args()
    .add(Storage.get(PROFILE_OWNERS.concat(profileContractAddress)))
    .serialize();
}

/**
 * Sets or updates the profile contract template.
 * Only the contract owner can execute this function.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the new template address.
 */
export function setProfileTemplate(binaryArgs: StaticArray<u8>): void {
  assert(
    caller().toString() == Storage.get(OWNER_KEY),
    'Only Owner address can execute this function',
  );

  const args = new Args(binaryArgs);
  const addressOfTemplate = args
    .nextString()
    .expect('Template address required');

  Storage.set(ACCOUNT_TEMPLATE, addressOfTemplate);

  generateEvent(createEvent('AccountTemplateChanged', [addressOfTemplate]));
}

/**
 * Deletes a user's profile from the system.
 *
 * @param {StaticArray<u8>} binaryArgs - Serialized arguments containing the user's address.
 */
export function deleteProfile(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const userAddress = args.nextString().expect('Missing userAddress argument');

  const profile = profileMap.getSome(userAddress);

  assert(
    caller().toString() == profile.profileContract.toString(),
    'Caller does not have permission to delete this profile',
  );

  let users = new Args(Storage.get(USERS)).nextStringArray().unwrap();
  users.splice(users.indexOf(userAddress), 1);
  Storage.set(USERS, new Args().add<Array<string>>(users).serialize());
  profileMap.delete(userAddress);
  Storage.del(PROFILE_OWNERS.concat(caller().toString()));

  generateEvent(
    createEvent('ProfileDeleted', [
      userAddress,
      profile.profileContract.toString(),
    ]),
  );
}
