// ============================================================
// MODULE PREDICTIONS — Intégration avec le microservice IA
// ============================================================

import {
  Controller, Get, Param, Query, UseGuards,
  Logger, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduleModule } from '@nestjs/schedule';

// ---- Service ----

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);

  constructor(
    @InjectModel('Prediction') private readonly predictionModel: Model<any>,
    @InjectModel('Price') private readonly priceModel: Model<any>,
    @InjectModel('Crop') private readonly cropModel: Model<any>,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Récupère la dernière prédiction disponible pour une culture/région
   * Si elle est trop ancienne (>24h), déclenche une nouvelle prédiction
   */
  async getPrediction(cropId: string, region: string) {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);

    // Cherche une prédiction récente
    let prediction = await this.predictionModel
      .findOne({
        cropId: new Types.ObjectId(cropId),
        region,
        generatedAt: { $gte: yesterday },
      })
      .sort({ generatedAt: -1 })
      .lean();

    if (!prediction) {
      this.logger.log(`Génération d'une nouvelle prédiction pour ${cropId}/${region}`);
      prediction = await this.generatePrediction(cropId, region);
    }

    return prediction;
  }

  /**
   * Appelle le microservice Python pour générer une prédiction
   * Fallback vers l'implémentation JS si le service Python est indisponible
   */
  async generatePrediction(cropId: string, region: string) {
    // Récupère les 90 derniers jours de données historiques
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const historicalPrices = await this.priceModel
      .find({
        cropId: new Types.ObjectId(cropId),
        region,
        date: { $gte: since },
      })
      .sort({ date: 1 })
      .lean();

    if (historicalPrices.length < 7) {
      throw new NotFoundException(
        'Données insuffisantes pour générer une prédiction (minimum 7 jours requis)',
      );
    }

    // Prépare les données pour le service Python
    const timeseriesData = historicalPrices.map((p) => ({
      ds: p.date, // Format Prophet
      y: p.pricePerUnit,
    }));

    let predictionResult;

    try {
      // Appel au microservice Python
      const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
      const response = await firstValueFrom(
        this.httpService.post(`${aiServiceUrl}/predict`, {
          crop_id: cropId,
          region,
          timeseries: timeseriesData,
          forecast_days: 30,
        }),
      );
      predictionResult = response.data;
    } catch (err) {
      this.logger.warn('Service Python indisponible, fallback JS');
      // Fallback: prédiction simplifiée en JavaScript
      predictionResult = this.jsFallbackPrediction(timeseriesData);
    }

    // Sauvegarde en base
    const saved = await this.predictionModel.create({
      cropId: new Types.ObjectId(cropId),
      region,
      generatedAt: new Date(),
      dailyForecasts: predictionResult.daily_forecasts,
      forecast7Days: predictionResult.forecast_7_days,
      forecast30Days: predictionResult.forecast_30_days,
      trend: predictionResult.trend,
      percentageChange: predictionResult.percentage_change,
      modelVersion: predictionResult.model_version || 'fallback-v1',
      modelConfidence: predictionResult.confidence || 0.7,
    });

    return saved;
  }

  /**
   * Prédiction de secours en JavaScript (régression linéaire simple)
   * Utilisée quand le microservice Python est indisponible
   */
  private jsFallbackPrediction(data: { ds: Date; y: number }[]) {
    const n = data.length;
    const prices = data.map((d) => d.y);

    // Régression linéaire simple
    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (prices[i] - yMean);
      denominator += (i - xMean) ** 2;
    }
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Génère les prédictions pour 30 jours
    const dailyForecasts = Array.from({ length: 30 }, (_, i) => {
      const predicted = intercept + slope * (n + i);
      // Ajout d'un bruit saisonnier simple (±5%)
      const seasonalFactor = 1 + 0.05 * Math.sin((2 * Math.PI * (n + i)) / 365);
      return {
        date: new Date(Date.now() + (i + 1) * 86400000),
        predictedPrice: Math.max(0, Math.round(predicted * seasonalFactor)),
        confidence: Math.max(0.3, 0.85 - i * 0.01), // Confiance décroissante
      };
    });

    const currentPrice = prices[n - 1];
    const forecast7 = dailyForecasts[6].predictedPrice;
    const forecast30 = dailyForecasts[29].predictedPrice;
    const pctChange = ((forecast30 - currentPrice) / currentPrice) * 100;

    return {
      daily_forecasts: dailyForecasts,
      forecast_7_days: forecast7,
      forecast_30_days: forecast30,
      trend: pctChange > 3 ? 'UP' : pctChange < -3 ? 'DOWN' : 'STABLE',
      percentage_change: Math.round(pctChange * 10) / 10,
      confidence: 0.65,
      model_version: 'js-linear-v1',
    };
  }

  /**
   * Tâche planifiée: regénère toutes les prédictions chaque nuit
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async refreshAllPredictions() {
    this.logger.log('Mise à jour nocturne des prédictions...');
    const crops = await this.cropModel.find({ isActive: true }).lean();
    const regions = ['Dakar', 'Thiès', 'Ziguinchor', 'Kaolack', 'Saint-Louis'];

    for (const crop of crops) {
      for (const region of regions) {
        try {
          await this.generatePrediction(crop._id.toString(), region);
        } catch (e) {
          this.logger.warn(`Échec prédiction ${crop.name}/${region}: ${e.message}`);
        }
      }
    }
    this.logger.log('Mise à jour des prédictions terminée');
  }
}

// ---- Controller ----

@ApiTags('predictions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Get(':cropId')
  @ApiOperation({ summary: 'Obtenir la prédiction IA pour une culture' })
  async getPrediction(
    @Param('cropId') cropId: string,
    @Query('region') region: string,
  ) {
    return this.predictionsService.getPrediction(cropId, region || 'Dakar');
  }

  @Get(':cropId/generate')
  @ApiOperation({ summary: 'Forcer la régénération d\'une prédiction' })
  async generatePrediction(
    @Param('cropId') cropId: string,
    @Query('region') region: string,
  ) {
    return this.predictionsService.generatePrediction(cropId, region || 'Dakar');
  }
}

// ---- Module ----

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Prediction', schema: require('../../schemas').PredictionSchema },
      { name: 'Price', schema: require('../../schemas').PriceSchema },
      { name: 'Crop', schema: require('../../schemas').CropSchema },
    ]),
    HttpModule.register({ timeout: 10000 }),
  ],
  controllers: [PredictionsController],
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
