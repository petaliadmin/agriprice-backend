// =============================================================
// MODULE USERS — Gestion des profils agriculteurs
// =============================================================

import {
  Controller, Get, Patch, Delete, Body, Param,
  UseGuards, Request, ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthGuard } from '@nestjs/passport';
import { IsString, IsOptional, IsArray, IsMongoId } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ---- DTOs ----

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Amadou Diallo' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+221777123456' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Thiès' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional()
  @IsString()
  language?: string;
}

export class UpdateFcmTokenDto {
  @IsString()
  fcmToken: string;
}

export class UpdateFollowedCropsDto {
  @IsArray()
  @IsMongoId({ each: true })
  cropIds: string[];
}

// ---- Service ----

@Injectable()
export class UsersService {
  constructor(
    @InjectModel('User') private readonly userModel: Model<any>,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .populate('followedCrops', 'name slug unit imageUrl')
      .lean() as any;

    if (!user) throw new ForbiddenException('Utilisateur introuvable');

    // Exclure le mot de passe
    const { password, ...profile } = user;
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    const updated = await this.userModel
      .findByIdAndUpdate(userId, { $set: dto }, { new: true })
      .populate('followedCrops', 'name slug unit')
      .lean() as any;

    const { password, ...profile } = updated;
    return profile;
  }

  async updateFcmToken(userId: string, fcmToken: string) {
    await this.userModel.findByIdAndUpdate(userId, { $set: { fcmToken } });
    return { success: true };
  }

  async updateFollowedCrops(userId: string, cropIds: string[]) {
    const objectIds = cropIds.map((id) => new Types.ObjectId(id));
    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { followedCrops: objectIds } },
        { new: true },
      )
      .populate('followedCrops', 'name slug unit')
      .lean() as any;

    const { password, ...profile } = updated;
    return profile;
  }

  async deleteAccount(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, { $set: { isActive: false } });
    return { success: true, message: 'Compte désactivé' };
  }

  // Admin: liste tous les utilisateurs
  async getAllUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel
        .find({ isActive: true })
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments({ isActive: true }),
    ]);

    return {
      data: users,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}

// ---- Controller ----

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Récupérer mon profil' })
  async getProfile(@Request() req) {
    return this.usersService.getProfile(req.user._id.toString());
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour mon profil' })
  async updateProfile(@Request() req, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(req.user._id.toString(), dto);
  }

  @Patch('me/fcm-token')
  @ApiOperation({ summary: 'Enregistrer le token FCM pour les notifications' })
  async updateFcmToken(@Request() req, @Body() dto: UpdateFcmTokenDto) {
    return this.usersService.updateFcmToken(
      req.user._id.toString(),
      dto.fcmToken,
    );
  }

  @Patch('me/followed-crops')
  @ApiOperation({ summary: 'Mettre à jour les cultures suivies' })
  async updateFollowedCrops(@Request() req, @Body() dto: UpdateFollowedCropsDto) {
    return this.usersService.updateFollowedCrops(
      req.user._id.toString(),
      dto.cropIds,
    );
  }

  @Delete('me')
  @ApiOperation({ summary: 'Supprimer mon compte (désactivation)' })
  async deleteAccount(@Request() req) {
    return this.usersService.deleteAccount(req.user._id.toString());
  }
}

// ---- Module ----

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: require('../../schemas').UserSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
