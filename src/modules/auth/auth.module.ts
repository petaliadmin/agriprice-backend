// ============================================================
// MODULE AUTH — JWT Authentication
// ============================================================

import {
  Controller, Post, Body, UseGuards, Get, Request,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ---- DTOs ----

export class RegisterDto {
  @ApiProperty({ example: 'amadou.diallo@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Amadou Diallo' })
  @IsString()
  name: string;

  @ApiProperty({ example: '+221777123456' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'Dakar' })
  @IsString()
  region: string;

  @ApiProperty({ example: 'motDePasse123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'amadou.diallo@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'motDePasse123' })
  @IsString()
  password: string;
}

// ---- Service ----

@Injectable()
export class AuthService {
  constructor(
    @InjectModel('User') private readonly userModel: Model<any>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) throw new UnauthorizedException('Cet email est déjà utilisé');

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.userModel.create({
      ...dto,
      password: hashedPassword,
    });

    const token = this.jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        region: user.region,
        role: user.role,
      },
    };
  }

  async login(dto: LoginDto) {
    // Sélection explicite du mot de passe (champ select: false)
    const user = await this.userModel
      .findOne({ email: dto.email })
      .select('+password');

    if (!user) throw new UnauthorizedException('Identifiants incorrects');

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) throw new UnauthorizedException('Identifiants incorrects');

    if (!user.isActive) throw new UnauthorizedException('Compte désactivé');

    const token = this.jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        region: user.region,
        role: user.role,
      },
    };
  }

  async validateToken(payload: any) {
    const user = await this.userModel.findById(payload.sub);
    if (!user || !user.isActive) return null;
    return user;
  }
}

// ---- Controller ----

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Créer un nouveau compte agriculteur' })
  @ApiResponse({ status: 201, description: 'Compte créé avec succès' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion avec email et mot de passe' })
  @ApiResponse({ status: 200, description: 'Connexion réussie, token JWT retourné' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}

// ---- JWT Strategy (Passport) ----

import { Strategy, ExtractJwt } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const user = await this.authService.validateToken(payload);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

// ---- Module ----

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([{ name: 'User', schema: require('../../schemas').UserSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
