// =============================================================
// MODULE ALERTS — Alertes de prix + notifications Firebase
// =============================================================

import {
  Controller, Get, Post, Patch, Body, Param,
  UseGuards, Request, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { IsString, IsOptional, IsMongoId } from 'class-validator';

// Firebase Admin (optionnel — fonctionne sans)
let firebaseAdmin: any = null;
try {
  firebaseAdmin = require('firebase-admin');
} catch {
  // Firebase non installé, notifications désactivées
}

// ---- DTOs ----

export class CreateAlertDto {
  @IsMongoId()
  userId: string;

  @IsMongoId()
  cropId: string;

  @IsString()
  region: string;

  @IsString()
  type: string;

  @IsString()
  message: string;

  @IsOptional()
  triggerPrice?: number;
}

// ---- Service ----

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private firebaseInitialized = false;

  constructor(
    @InjectModel('Alert') private readonly alertModel: Model<any>,
    @InjectModel('User') private readonly userModel: Model<any>,
    private readonly config: ConfigService,
  ) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    if (!firebaseAdmin) return;

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    if (!projectId) {
      this.logger.warn('Firebase non configuré (FIREBASE_PROJECT_ID manquant)');
      return;
    }

    try {
      if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert({
            projectId,
            clientEmail: this.config.get('FIREBASE_CLIENT_EMAIL'),
            privateKey: this.config
              .get('FIREBASE_PRIVATE_KEY')
              ?.replace(/\\n/g, '\n'),
          }),
        });
      }
      this.firebaseInitialized = true;
      this.logger.log('Firebase initialisé avec succès');
    } catch (e) {
      this.logger.warn(`Firebase init échoué: ${e.message}`);
    }
  }

  /**
   * Récupère les alertes d'un utilisateur
   */
  async getUserAlerts(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [alerts, unreadCount] = await Promise.all([
      this.alertModel
        .find({ userId: new Types.ObjectId(userId) })
        .populate('cropId', 'name slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.alertModel.countDocuments({
        userId: new Types.ObjectId(userId),
        isRead: false,
      }),
    ]);

    return { alerts, unreadCount };
  }

  /**
   * Marque une alerte comme lue
   */
  async markAsRead(alertId: string, userId: string) {
    return this.alertModel.findOneAndUpdate(
      { _id: alertId, userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
      { new: true },
    );
  }

  /**
   * Marque toutes les alertes d'un utilisateur comme lues
   */
  async markAllAsRead(userId: string) {
    const result = await this.alertModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
    return { updated: result.modifiedCount };
  }

  /**
   * Crée une alerte et envoie une notification push
   */
  async createAlert(dto: CreateAlertDto) {
    const alert = await this.alertModel.create({
      ...dto,
      userId: new Types.ObjectId(dto.userId),
      cropId: new Types.ObjectId(dto.cropId),
    });

    // Envoi de la notification push (non-bloquant)
    this.sendPushNotification(dto.userId, dto.message, dto.type).catch((e) =>
      this.logger.warn(`Push notification échoué: ${e.message}`),
    );

    return alert;
  }

  /**
   * Envoie une notification push via Firebase
   */
  async sendPushNotification(userId: string, message: string, type: string) {
    if (!this.firebaseInitialized) return;

    const user = await this.userModel.findById(userId).select('fcmToken').lean() as any;
    if (!user?.fcmToken) return;

    const titles: Record<string, string> = {
      PRICE_UP: '📈 Prix en hausse !',
      PRICE_DOWN: '📉 Prix en baisse',
      SELL_NOW: '💰 Moment de vendre !',
      PREDICTION_READY: '🤖 Nouvelle prédiction',
    };

    try {
      await firebaseAdmin.messaging().send({
        token: user.fcmToken,
        notification: {
          title: titles[type] || '🌾 AgriPrix',
          body: message,
        },
        data: { type, userId },
        android: {
          priority: 'high',
          notification: {
            channelId: 'agriprix_prices',
            color: '#2E7D32',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      });

      // Marque l'alerte comme push envoyé
      await this.alertModel.updateOne(
        { userId: new Types.ObjectId(userId), message },
        { $set: { isPushSent: true } },
      );
    } catch (e) {
      this.logger.warn(`FCM send error: ${e.message}`);
    }
  }

  /**
   * Envoie des alertes en masse lors d'un changement de prix significatif
   * Appelé par le module Predictions après régénération
   */
  async broadcastPriceAlert(
    cropId: string,
    cropName: string,
    region: string,
    changePercent: number,
    trend: 'UP' | 'DOWN',
  ) {
    const minChange = 8; // Seuil: alerte seulement si ≥8% de variation
    if (Math.abs(changePercent) < minChange) return;

    // Trouve les utilisateurs qui suivent cette culture et sont dans la région
    const users = await this.userModel
      .find({
        isActive: true,
        followedCrops: { $in: [new Types.ObjectId(cropId)] },
        $or: [{ region }, { region: null }],
      })
      .select('_id')
      .lean();

    const type = trend === 'UP' ? 'PRICE_UP' : 'PRICE_DOWN';
    const sign = changePercent > 0 ? '+' : '';
    const message =
      trend === 'UP'
        ? `Le prix de ${cropName} devrait augmenter de ${sign}${changePercent.toFixed(1)}% à ${region}. Bon moment d'attendre.`
        : `Le prix de ${cropName} devrait baisser de ${Math.abs(changePercent).toFixed(1)}% à ${region}. Vendez maintenant.`;

    // Crée les alertes pour tous les utilisateurs concernés (par batch)
    const batchSize = 50;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const alertDocs = batch.map((u) => ({
        userId: u._id,
        cropId: new Types.ObjectId(cropId),
        region,
        type,
        message,
        isRead: false,
        isPushSent: false,
      }));

      await this.alertModel.insertMany(alertDocs);

      // Notifications push (en parallèle, non-bloquant)
      batch.forEach((u) =>
        this.sendPushNotification(u._id.toString(), message, type).catch(() => {}),
      );
    }

    this.logger.log(
      `${users.length} alertes envoyées pour ${cropName}/${region} (${sign}${changePercent.toFixed(1)}%)`,
    );
  }
}

// ---- Controller ----

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Mes alertes (avec compteur non lus)' })
  async getAlerts(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.alertsService.getUserAlerts(
      req.user._id.toString(),
      page,
      limit,
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marquer une alerte comme lue' })
  async markAsRead(@Param('id') id: string, @Request() req) {
    return this.alertsService.markAsRead(id, req.user._id.toString());
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marquer toutes les alertes comme lues' })
  async markAllAsRead(@Request() req) {
    return this.alertsService.markAllAsRead(req.user._id.toString());
  }
}

// ---- Module ----

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Alert', schema: require('../../schemas').AlertSchema },
      { name: 'User', schema: require('../../schemas').UserSchema },
    ]),
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
