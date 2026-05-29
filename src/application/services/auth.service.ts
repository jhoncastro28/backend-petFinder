import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  LogoutDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '../dtos/auth';
import { PasswordHashService } from './password-hash.service';
import { RefreshTokenSessionService } from './refresh-token-session.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { IUserRepository } from '../../domain/repositories';

interface JwtTokenPayload {
  sub?: string;
  email?: string;
  purpose?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly passwordHashService: PasswordHashService,
    private readonly refreshTokenSessionService: RefreshTokenSessionService,
    private readonly emailService: EmailService,
    @Inject('IUserRepository')
    private readonly userRepository: IUserRepository,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(registerDto);
    const tokenPair = await this.refreshTokenSessionService.issueTokenPair(user.id, user.email);

    // Enviar correo de verificación (no bloquea si falla)
    const verificationToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'email_verification' },
      { expiresIn: '24h' },
    );
    this.emailService
      .sendEmailVerification(user.email, verificationToken)
      .catch((err) =>
        this.logger.warn(
          `No se pudo enviar correo de verificación a ${user.email}: ${err.message}`,
        ),
      );

    return new AuthResponseDto({
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      tokenType: tokenPair.tokenType,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepository.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar bloqueo de cuenta ANTES de comparar contraseña
    if (user.isAccountLocked()) {
      const lockedUntil = user.accountLockedUntil;
      const minutesLeft = lockedUntil
        ? Math.ceil((lockedUntil.getTime() - Date.now()) / 60000)
        : 30;
      throw new UnauthorizedException(
        `Cuenta bloqueada por demasiados intentos fallidos. Intenta de nuevo en ${minutesLeft} minuto(s).`,
      );
    }

    const isPasswordValid = await this.passwordHashService.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      // Registrar intento fallido y persistir
      user.recordFailedLoginAttempt();
      await this.userRepository.update(user.id, user);

      if (user.isAccountLocked()) {
        throw new UnauthorizedException(
          'Cuenta bloqueada por 5 intentos fallidos consecutivos. Intenta de nuevo en 30 minutos.',
        );
      }

      const remaining = 5 - (user.failedLoginAttempts ?? 0);
      throw new UnauthorizedException(
        remaining > 0
          ? `Credenciales inválidas. Te quedan ${remaining} intento(s) antes de que la cuenta se bloquee.`
          : 'Credenciales inválidas.',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Usuario inactivo. Contacta al soporte.');
    }

    // Registrar login exitoso y limpiar intentos fallidos
    user.recordSuccessfulLogin();
    await this.userRepository.update(user.id, user);

    const tokenPair = await this.refreshTokenSessionService.issueTokenPair(user.id, user.email);

    return new AuthResponseDto({
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      tokenType: tokenPair.tokenType,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  }

  async validateToken(token: string): Promise<Record<string, unknown>> {
    try {
      return this.jwtService.verify(token) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }

  async refresh(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!token) {
      throw new BadRequestException('Refresh token requerido');
    }

    const tokenPair = await this.refreshTokenSessionService.rotateTokenPair(token);
    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
    };
  }

  async logout(logoutDto?: LogoutDto): Promise<{ message: string }> {
    const refreshToken = logoutDto?.token ?? logoutDto?.refreshToken;
    await this.refreshTokenSessionService.revokeByToken(refreshToken);
    return { message: 'Sesión cerrada correctamente' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);

    // Respuesta genérica para evitar enumeración de usuarios
    const genericMessage =
      'Si el correo existe en nuestra plataforma, recibirás un enlace para restablecer tu contraseña en los próximos minutos.';

    if (!user) {
      return { message: genericMessage };
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'password_reset' },
      { expiresIn: '15m' },
    );

    // Enviar correo real (no bloquea si falla)
    this.emailService
      .sendPasswordResetEmail(user.email, resetToken)
      .catch((err) =>
        this.logger.error(`Error al enviar correo de reset a ${user.email}: ${err.message}`),
      );

    return { message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    let payload: JwtTokenPayload;
    try {
      payload = this.jwtService.verify(dto.token);
    } catch (err) {
      throw new BadRequestException(
        'El enlace de restablecimiento es inválido o ya expiró. Solicita uno nuevo.',
        { cause: err },
      );
    }

    if (payload.purpose !== 'password_reset') {
      throw new BadRequestException('Token de restablecimiento inválido.');
    }

    const user = await this.usersService.findByEmail(payload.email);
    if (!user?.isActive) {
      throw new BadRequestException('No se puede restablecer la contraseña de este usuario.');
    }

    const hashedPassword = await this.passwordHashService.hash(dto.newPassword);
    await this.usersService.updatePasswordHash(user.id, hashedPassword);

    return { message: 'Contraseña restablecida correctamente. Ya puedes iniciar sesión.' };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    let payload: JwtTokenPayload;
    try {
      payload = this.jwtService.verify(dto.token);
    } catch (err) {
      throw new BadRequestException(
        'El enlace de verificación es inválido o ya expiró. Inicia sesión para solicitar uno nuevo.',
        { cause: err },
      );
    }

    if (payload.purpose !== 'email_verification') {
      throw new BadRequestException('Token de verificación inválido.');
    }

    const user = await this.usersService.findByEmail(payload.email);
    if (!user) {
      throw new BadRequestException('Usuario no encontrado.');
    }

    await this.usersService.markEmailAsVerified(user.id);
    return { message: 'Correo verificado correctamente. Tu cuenta está activa.' };
  }

  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.refreshTokenSessionService.revokeAllByUser(userId);
    return { message: 'Todas las sesiones fueron cerradas.' };
  }
}
