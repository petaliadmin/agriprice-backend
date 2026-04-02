// =============================================================
// MODULE CROPS — Gestion des cultures agricoles
// =============================================================

import {
  Controller, Get, Post, Patch, Delete, Body,
  Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthGuard } from '@nestjs/passport';
import {
  IsString, IsOptional, IsArray, IsNumber, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ---- DTOs ----

export class CreateCropDto {
  @ApiProperty({ example: 'Maïs' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'mais' })
  @IsString()
  slug: string;

  @ApiPropertyOptional({ example: 'Mbéy' })
  @IsOptional()
  @IsString()
  nameLocal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'kg' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: [10, 11, 12] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  harvestMonths?: number[];
}

// ---- Service ----

@Injectable()
export class CropsService {
  constructor(
    @InjectModel('Crop') private readonly cropModel: Model<any>,
  ) {}

  async findAll(activeOnly = true) {
    const filter = activeOnly ? { isActive: true } : {};
    return this.cropModel.find(filter).sort({ name: 1 }).lean();
  }

  async findOne(id: string) {
    const crop = await this.cropModel.findById(id).lean();
    if (!crop) throw new NotFoundException('Culture introuvable');
    return crop;
  }

  async findBySlug(slug: string) {
    const crop = await this.cropModel.findOne({ slug }).lean();
    if (!crop) throw new NotFoundException(`Culture "${slug}" introuvable`);
    return crop;
  }

  async create(dto: CreateCropDto) {
    return this.cropModel.create({ ...dto, isActive: true });
  }

  async update(id: string, dto: Partial<CreateCropDto>) {
    const updated = await this.cropModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .lean();
    if (!updated) throw new NotFoundException('Culture introuvable');
    return updated;
  }

  async toggleActive(id: string) {
    const crop = await this.cropModel.findById(id);
    if (!crop) throw new NotFoundException('Culture introuvable');
    crop.isActive = !crop.isActive;
    return crop.save();
  }

  /**
   * Retourne les cultures actuellement en saison de récolte
   * Utile pour prioriser les recommandations
   */
  async getCropsInHarvestSeason() {
    const currentMonth = new Date().getMonth() + 1;
    return this.cropModel
      .find({
        isActive: true,
        harvestMonths: { $in: [currentMonth] },
      })
      .lean();
  }
}

// ---- Controller ----

@ApiTags('crops')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('crops')
export class CropsController {
  constructor(private readonly cropsService: CropsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister toutes les cultures actives' })
  async findAll(@Query('all') all?: string) {
    return this.cropsService.findAll(all !== 'true');
  }

  @Get('harvest-season')
  @ApiOperation({ summary: 'Cultures actuellement en saison de récolte' })
  async getHarvestSeason() {
    return this.cropsService.getCropsInHarvestSeason();
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Récupérer une culture par son slug' })
  async findBySlug(@Param('slug') slug: string) {
    return this.cropsService.findBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer une culture par ID' })
  async findOne(@Param('id') id: string) {
    return this.cropsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer une nouvelle culture (admin)' })
  async create(@Body() dto: CreateCropDto) {
    return this.cropsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une culture (admin)' })
  async update(@Param('id') id: string, @Body() dto: Partial<CreateCropDto>) {
    return this.cropsService.update(id, dto);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Activer/désactiver une culture (admin)' })
  async toggle(@Param('id') id: string) {
    return this.cropsService.toggleActive(id);
  }
}

// ---- Module ----

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Crop', schema: require('../../schemas').CropSchema },
    ]),
  ],
  controllers: [CropsController],
  providers: [CropsService],
  exports: [CropsService],
})
export class CropsModule {}
