import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';

// User Profile structure
export class Profile implements Serializable {
  constructor(
    public profileContract: Address = new Address(''),
    public address: Address = new Address(''),
    public firstName: string = '',
    public lastName: string = '',
    public avatar: string = '',
    public bio: string = '',
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.profileContract)
      .add(this.address)
      .add(this.firstName)
      .add(this.lastName)
      .add(this.avatar)
      .add(this.bio)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);

    this.profileContract = new Address(
      args.nextString().expect('Failed to deserialize profile address'),
    );
    this.address = new Address(
      args.nextString().expect('Failed to deserialize address'),
    );
    this.firstName = args
      .nextString()
      .expect('Failed to deserialize firstname');
    this.lastName = args.nextString().expect('Failed to deserialize lastName');
    this.avatar = args.nextString().expect('Failed to deserialize avatar');
    this.bio = args.nextString().expect('Failed to deserialize bio');
    return new Result(args.offset);
  }

  toString(): string {
    return `"Address": "${this.address.toString()}", "Name": "${
      this.firstName
    }", "Bio": "${this.bio}", Avatar: "${this.avatar}"`;
  }
}
