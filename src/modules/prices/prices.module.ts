// ============================================================
// MODULE PRICES — Gestion des prix agricoles
// ============================================================

import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthGuard } from '@nestjs/passport';
import {
  IsMongoId, IsString, IsNumber, IsDateString,
  IsEnum, IsOptional, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ---- DTOs ----

export class CreatePriceDto {
  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d' })
  @IsMongoId()
  cropId: string;

  @ApiProperty({ example: 'Dakar' })
  @IsString()
  region: string;

  @ApiProperty({ example: 'Marché Sandaga' })
  @IsString()
  market: string;

  @ApiProperty({ example: 350, description: 'Prix en FCFA par kg' })
  @IsNumber()
  @Min(0)
  pricePerUnit: number;

  @ApiProperty({ example: 'XOF' })
  @IsString()
  currency: string;

  @ApiProperty({ example: '2024-06-15' })
  @IsDateString()
  date: string;
}

export class GetPricesQueryDto {
  @ApiPropertyOptional({ example: '665f1a2b3c4d5e6f7a8b9c0d' })
  @IsOptional()
  @IsMongoId()
  cropId?: string;

  @ApiPropertyOptional({ example: 'Dakar' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 30, description: 'Nombre de jours historiques' })
  @IsOptional()
  @IsNumber()
  days?: number;
}

// ---- Service ----

@Injectable()
export class PricesService {
  constructor(
    @InjectModel('Price') private readonly priceModel: Model<any>,
    @InjectModel('Crop') private readonly cropModel: Model<any>,
  ) {}

  /**
   * Récupère les prix récents avec filtres optionnels
   */
  async getPrices(query: GetPricesQueryDto) {
    const filter: any = {};
    if (query.cropId) filter.cropId = new Types.ObjectId(query.cropId);
    if (query.region) filter.region = query.region;

    if (query.days) {
      const since = new Date();
      since.setDate(since.getDate() - query.days);
      filter.date = { $gte: since };
    }

    const prices = await this.priceModel
      .find(filter)
      .populate('cropId', 'name slug unit')
      .sort({ date: -1 })
      .limit(200)
      .lean();

    return prices;
  }

  /**
   * Retourne l'historique des prix d'une culture spécifique
   * avec statistiques (min, max, moyenne, tendance)
   */
  async getPriceByCrop(cropId: string, region?: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const filter: any = {
      cropId: new Types.ObjectId(cropId),
      date: { $gte: since },
    };
    if (region) filter.region = region;

    const prices = await this.priceModel
      .find(filter)
      .sort({ date: 1 })
      .lean();

    if (!prices.length) return { prices: [], stats: null };

    // Calcul des statistiques
    const values = prices.map((p) => p.pricePerUnit);
    const minPrice = Math.min(...values);
    const maxPrice = Math.max(...values);
    const avgPrice = values.reduce((a, b) => a + b, 0) / values.length;

    // Tendance: comparaison première et dernière semaine
    const firstWeek = values.slice(0, Math.min(7, values.length));
    const lastWeek = values.slice(-Math.min(7, values.length));
    const firstAvg = firstWeek.reduce((a, b) => a + b, 0) / firstWeek.length;
    const lastAvg = lastWeek.reduce((a, b) => a + b, 0) / lastWeek.length;
    const trendPct = ((lastAvg - firstAvg) / firstAvg) * 100;

    return {
      prices,
      stats: {
        min: minPrice,
        max: maxPrice,
        average: Math.round(avgPrice),
        current: values[values.length - 1],
        trendPercentage: Math.round(trendPct * 10) / 10,
        trend: trendPct > 2 ? 'UP' : trendPct < -2 ? 'DOWN' : 'STABLE',
      },
    };
  }

  /**
   * Récupère les prix par région — pour la carte
   */
  async getPricesByRegion(cropId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 7); // Dernière semaine

    const result = await this.priceModel.aggregate([
      {
        $match: {
          cropId: new Types.ObjectId(cropId),
          date: { $gte: since },
        },
      },
      {
        $group: {
          _id: '$region',
          avgPrice: { $avg: '$pricePerUnit' },
          latestPrice: { $last: '$pricePerUnit' },
          market: { $last: '$market' },
          count: { $sum: 1 },
        },
      },
      { $sort: { latestPrice: -1 } },
    ]);

    return result.map((r) => ({
      region: r._id,
      averagePrice: Math.round(r.avgPrice),
      latestPrice: r.latestPrice,
      market: r.market,
      dataPoints: r.count,
    }));
  }

  /**
   * Ajoute un nouveau prix (admin ou collecteur de données)
   */
  async createPrice(dto: CreatePriceDto) {
    const price = await this.priceModel.create(dto);
    return price;
  }

  /**
   * Dashboard — prix actuels de toutes les cultures
   */
  async getDashboardPrices(region?: string) {
    const crops = await this.cropModel.find({ isActive: true }).lean();
    const result = [];

    for (const crop of crops) {
      const filter: any = { cropId: crop._id };
      if (region) filter.region = region;

      const latest = await this.priceModel
        .findOne(filter)
        .sort({ date: -1 })
        .lean() as any;

      const weekAgo = await this.priceModel
        .findOne({
          ...filter,
          date: { $lte: new Date(Date.now() - 7 * 86400000) },
        })
        .sort({ date: -1 })
        .lean() as any;

      if (latest) {
        const change = weekAgo
          ? ((latest.pricePerUnit - weekAgo.pricePerUnit) / weekAgo.pricePerUnit) * 100
          : 0;

        result.push({
          crop: { id: crop._id, name: crop.name, slug: crop.slug, unit: crop.unit },
          currentPrice: latest.pricePerUnit,
          currency: latest.currency,
          market: latest.market,
          region: latest.region,
          date: latest.date,
          weeklyChange: Math.round(change * 10) / 10,
          trend: change > 2 ? 'UP' : change < -2 ? 'DOWN' : 'STABLE',
        });
      }
    }

    return result;
  }
}

// ---- Controller ----

@ApiTags('prices')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get()
  @ApiOperation({ summary: 'Récupérer les prix avec filtres' })
  @ApiQuery({ name: 'cropId', required: false })
  @ApiQuery({ name: 'region', required: false })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getPrices(@Query() query: GetPricesQueryDto) {
    return this.pricesService.getPrices(query);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Prix du tableau de bord (toutes cultures)' })
  async getDashboard(@Query('region') region?: string) {
    return this.pricesService.getDashboardPrices(region);
  }

  @Get('regions/:cropId')
  @ApiOperation({ summary: 'Prix par région pour une culture (carte)' })
  async getPricesByRegion(@Param('cropId') cropId: string) {
    return this.pricesService.getPricesByRegion(cropId);
  }

  @Get(':cropId')
  @ApiOperation({ summary: 'Historique des prix pour une culture' })
  async getPriceByCrop(
    @Param('cropId') cropId: string,
    @Query('region') region?: string,
    @Query('days') days?: number,
  ) {
    return this.pricesService.getPriceByCrop(cropId, region, days);
  }

  @Post()
  @ApiOperation({ summary: 'Ajouter un prix (admin/collecteur)' })
  async createPrice(@Body() dto: CreatePriceDto) {
    return this.pricesService.createPrice(dto);
  }
}

// ---- Module ----

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Price', schema: require('../../schemas').PriceSchema },
      { name: 'Crop', schema: require('../../schemas').CropSchema },
    ]),
  ],
  controllers: [PricesController],
  providers: [PricesService],
  exports: [PricesService],
})
export class PricesModule {}
