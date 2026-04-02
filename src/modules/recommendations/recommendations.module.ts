// ============================================================
// MODULE RECOMMENDATIONS — Logique SELL / WAIT / STORE
// ============================================================

import { Controller, Get, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthGuard } from '@nestjs/passport';
import { PredictionsModule, PredictionsService } from '../predictions/predictions.module';

// ---- Service ----

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectModel('Recommendation') private readonly recommendationModel: Model<any>,
    @InjectModel('Price') private readonly priceModel: Model<any>,
    private readonly predictionsService: PredictionsService,
  ) {}

  /**
   * Génère une recommandation basée sur la prédiction IA
   *
   * Règles métier:
   * - Tendance UP forte (>10%)  → WAIT (attendre la hausse)
   * - Tendance UP modérée (>3%) → WAIT si stockage possible, sinon SELL
   * - Tendance STABLE           → SELL (mieux vaut vendre maintenant)
   * - Tendance DOWN             → SELL (vendre avant la baisse)
   * - Période post-récolte      → STORE (prix bas typiquement)
   */
  async getRecommendation(cropId: string, region: string) {
    // Cherche d'abord une recommandation récente (<12h)
    const recent = await this.recommendationModel
      .findOne({
        cropId: new Types.ObjectId(cropId),
        region,
        validUntil: { $gte: new Date() },
      })
      .lean();

    if (recent) return recent;

    // Génère une nouvelle recommandation
    return this.generateRecommendation(cropId, region);
  }

  async generateRecommendation(cropId: string, region: string) {
    const prediction = await this.predictionsService.getPrediction(cropId, region) as any;

    const { trend, percentageChange, forecast7Days, modelConfidence } = prediction;

    // Logique de recommandation
    let action: 'SELL' | 'WAIT' | 'STORE';
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    let reason: string;
    let reasonLocal: string;

    const absChange = Math.abs(percentageChange);

    if (trend === 'UP' && percentageChange > 10) {
      action = 'WAIT';
      confidence = modelConfidence > 0.75 ? 'HIGH' : 'MEDIUM';
      reason = `Les prix devraient augmenter de ${percentageChange.toFixed(1)}% dans les 30 prochains jours. Il est conseillé d'attendre.`;
      reasonLocal = `Daña bi dafay yéégél. Dëkk waat.`; // Wolof simplifié
    } else if (trend === 'UP' && percentageChange > 3) {
      action = 'WAIT';
      confidence = 'MEDIUM';
      reason = `Légère hausse attendue (+${percentageChange.toFixed(1)}%). Attendre 1-2 semaines peut être bénéfique.`;
      reasonLocal = `Liggéey yi dañuy ëmb. Xaar ak ndaw-ndaw.`;
    } else if (trend === 'DOWN') {
      action = 'SELL';
      confidence = absChange > 10 ? 'HIGH' : 'MEDIUM';
      reason = `Les prix risquent de baisser de ${Math.abs(percentageChange).toFixed(1)}% prochainement. Il vaut mieux vendre maintenant.`;
      reasonLocal = `Daña bi dafay weesu. Jaay léegi.`;
    } else {
      // Stable
      action = 'SELL';
      confidence = 'MEDIUM';
      reason = `Les prix sont stables. C'est un bon moment pour vendre.`;
      reasonLocal = `Daña bi yëkkël na. Yëgël am solo.`;
    }

    // Validité: 24 heures
    const validUntil = new Date(Date.now() + 24 * 3600 * 1000);

    const recommendation = await this.recommendationModel.create({
      cropId: new Types.ObjectId(cropId),
      region,
      action,
      confidence,
      reason,
      reasonLocal,
      validUntil,
      basedOnPrediction: prediction._id,
    });

    return recommendation;
  }

  /**
   * Retourne les recommandations pour toutes les cultures
   * suivies par un agriculteur
   */
  async getRecommendationsForFarmer(userId: string, region: string) {
    const userModel = this.recommendationModel.db.model('User');
    const user = await userModel.findById(userId).populate('followedCrops');

    if (!user) return [];

    const results = [];
    for (const crop of user.followedCrops) {
      const rec = await this.getRecommendation(crop._id.toString(), region);
      results.push({
        crop: { id: crop._id, name: crop.name, slug: crop.slug },
        recommendation: rec,
      });
    }
    return results;
  }
}

// ---- Controller ----

@ApiTags('recommendations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  @Get(':cropId')
  @ApiOperation({ summary: 'Recommandation SELL/WAIT/STORE pour une culture' })
  async getRecommendation(
    @Param('cropId') cropId: string,
    @Query('region') region: string,
  ) {
    return this.service.getRecommendation(cropId, region || 'Dakar');
  }

  @Get('farmer/all')
  @ApiOperation({ summary: 'Toutes les recommandations pour l\'agriculteur connecté' })
  async getForFarmer(@Request() req, @Query('region') region: string) {
    return this.service.getRecommendationsForFarmer(req.user._id.toString(), region || 'Dakar');
  }
}

// ---- Module ----

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Recommendation', schema: require('../../schemas').RecommendationSchema },
      { name: 'Price', schema: require('../../schemas').PriceSchema },
      { name: 'User', schema: require('../../schemas').UserSchema },
    ]),
    PredictionsModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
