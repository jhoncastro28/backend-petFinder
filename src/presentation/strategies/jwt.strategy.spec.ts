jest.mock('passport-jwt', () => ({
  ExtractJwt: { fromAuthHeaderAsBearerToken: jest.fn().mockReturnValue(jest.fn()) },
  Strategy: class MockJwtStrategy {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: any[]) {}
  },
}));

jest.mock('@nestjs/passport', () => ({
  PassportStrategy: (StrategyClass: any) => StrategyClass,
}));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../application/services';
import { User } from '../../domain/entities';
import { UserRole } from '../../domain/enums';

const makeUser = (overrides: Partial<{ isActive: boolean; id: string; email: string }> = {}) =>
  new User(
    overrides.id ?? 'user-1',
    overrides.email ?? 'test@example.com',
    'testuser',
    'hashed_pass',
    'Juan',
    'Pérez',
    UserRole.USER,
    overrides.isActive ?? true,
    new Date(),
    new Date(),
  );

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findByEmail: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    usersService = { findByEmail: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('test-secret') };
    strategy = new JwtStrategy(
      configService as unknown as ConfigService,
      usersService as unknown as UsersService,
    );
  });

  it('should return user payload for active user', async () => {
    const user = makeUser();
    usersService.findByEmail.mockResolvedValue(user);

    const result = await strategy.validate({ sub: 'user-1', email: 'test@example.com' });

    expect(result.id).toBe('user-1');
    expect(result.email).toBe('test@example.com');
    expect(result.role).toBe(UserRole.USER);
  });

  it('should throw UnauthorizedException when user not found', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'x', email: 'ghost@example.com' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when user is inactive', async () => {
    const user = makeUser({ isActive: false });
    usersService.findByEmail.mockResolvedValue(user);
    await expect(strategy.validate({ sub: user.id, email: user.email })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when account is locked', async () => {
    const user = makeUser();
    for (let i = 0; i < 5; i++) user.recordFailedLoginAttempt();
    usersService.findByEmail.mockResolvedValue(user);
    await expect(strategy.validate({ sub: user.id, email: user.email })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should include username and firstName in returned payload', async () => {
    const user = makeUser();
    usersService.findByEmail.mockResolvedValue(user);
    const result = await strategy.validate({ sub: 'user-1', email: 'test@example.com' });
    expect(result.username).toBe('testuser');
    expect(result.firstName).toBe('Juan');
  });
});
