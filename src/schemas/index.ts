// ============================================================
// SCHÉMAS MONGODB - AgriPrix
// Tous les schémas avec indexation optimisée
// ============================================================

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// ----------------------------------------------------------
// SCHEMA: User
// ----------------------------------------------------------
export type UserDocument = User & Document;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false }) // Jamais exposé dans les réponses
  password: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  phone: string;

  // Région de l'agriculteur pour les recommandations locales
  @Prop({ required: true })
  region: string;

  @Prop({ enum: ['farmer', 'admin'], default: 'farmer' })
  role: string;

  @Prop({ default: true })
  isActive: boolean;

  // Token FCM pour les notifications push
  @Prop()
  fcmToken?: string;

  // Langue préférée (fr par défaut)
  @Prop({ default: 'fr' })
  language: string;

  // Cultures suivies par l'agriculteur
  @Prop({ type: [Types.ObjectId], ref: 'Crop', default: [] })
  followedCrops: Types.ObjectId[];
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ region: 1 });

// ----------------------------------------------------------
// SCHEMA: Crop (Culture agricole)
// ----------------------------------------------------------
export type CropDocument = Crop & Document;

@Schema({ timestamps: true, collection: 'crops' })
export class Crop {
  @Prop({ required: true })
  name: string; // ex: "Maïs", "Millet", "Sorgho"

  @Prop({ required: true, unique: true })
  slug: string; // ex: "mais", "millet"

  @Prop()
  nameLocal?: string; // Nom en langue locale

  @Prop()
  description?: string;

  @Prop()
  imageUrl?: string;

  @Prop({ default: 'kg' })
  unit: string; // Unité de mesure (kg, tonne, sac)

  @Prop({ default: true })
  isActive: boolean;

  // Saisons de récolte (1-12 = Jan-Déc)
  @Prop({ type: [Number] })
  harvestMonths: number[];
}

export const CropSchema = SchemaFactory.createForClass(Crop);
CropSchema.index({ isActive: 1 });

// ----------------------------------------------------------
// SCHEMA: Price (Prix du marché)
// ----------------------------------------------------------
export type PriceDocument = Price & Document;

@Schema({ timestamps: true, collection: 'prices' })
export class Price {
  @Prop({ type: Types.ObjectId, ref: 'Crop', required: true })
  cropId: Types.ObjectId;

  @Prop({ required: true })
  region: string;

  @Prop({ required: true })
  market: string; // Nom du marché

  @Prop({ required: true, min: 0 })
  pricePerUnit: number; // Prix en FCFA par unité

  @Prop({ required: true })
  currency: string; // 'XOF' (FCFA), 'GHS', etc.

  @Prop({ required: true })
  date: Date;

  // Source de la donnée
  @Prop({ enum: ['manual', 'scraper', 'api', 'seed'], default: 'manual' })
  source: string;

  @Prop()
  sourceNote?: string;
}

export const PriceSchema = SchemaFactory.createForClass(Price);
// Index composé pour les requêtes de tendances historiques
PriceSchema.index({ cropId: 1, region: 1, date: -1 });
PriceSchema.index({ date: -1 });
PriceSchema.index({ region: 1 });

// ----------------------------------------------------------
// SCHEMA: Prediction (Prédiction IA)
// ----------------------------------------------------------
export type PredictionDocument = Prediction & Document;

@Schema({ timestamps: true, collection: 'predictions' })
export class Prediction {
  @Prop({ type: Types.ObjectId, ref: 'Crop', required: true })
  cropId: Types.ObjectId;

  @Prop({ required: true })
  region: string;

  // Date à partir de laquelle la prédiction est faite
  @Prop({ required: true })
  generatedAt: Date;

  // Prédictions journalières sur 30 jours
  @Prop({
    type: [
      {
        date: Date,
        predictedPrice: Number,
        confidence: Number, // 0-1
      },
    ],
  })
  dailyForecasts: {
    date: Date;
    predictedPrice: number;
    confidence: number;
  }[];

  // Résumé sur 7 jours
  @Prop()
  forecast7Days: number;

  // Résumé sur 30 jours
  @Prop()
  forecast30Days: number;

  // Tendance globale calculée
  @Prop({ enum: ['UP', 'DOWN', 'STABLE'] })
  trend: string;

  // Variation en pourcentage attendue
  @Prop()
  percentageChange: number;

  // Version du modèle IA utilisé
  @Prop({ default: 'v1.0' })
  modelVersion: string;

  // Fiabilité du modèle (0-1)
  @Prop()
  modelConfidence: number;
}

export const PredictionSchema = SchemaFactory.createForClass(Prediction);
PredictionSchema.index({ cropId: 1, region: 1, generatedAt: -1 });

// ----------------------------------------------------------
// SCHEMA: Recommendation
// ----------------------------------------------------------
export type RecommendationDocument = Recommendation & Document;

@Schema({ timestamps: true, collection: 'recommendations' })
export class Recommendation {
  @Prop({ type: Types.ObjectId, ref: 'Crop', required: true })
  cropId: Types.ObjectId;

  @Prop({ required: true })
  region: string;

  // Décision principale
  @Prop({ enum: ['SELL', 'WAIT', 'STORE'], required: true })
  action: string;

  // Niveau de confiance de la recommandation
  @Prop({ enum: ['HIGH', 'MEDIUM', 'LOW'], required: true })
  confidence: string;

  // Raison expliquée simplement (pour les agriculteurs)
  @Prop({ required: true })
  reason: string;

  // Raison en langue locale (optionnel)
  @Prop()
  reasonLocal?: string;

  // Horizon temporel de la recommandation
  @Prop({ required: true })
  validUntil: Date;

  @Prop({ type: Types.ObjectId, ref: 'Prediction' })
  basedOnPrediction: Types.ObjectId;
}

export const RecommendationSchema = SchemaFactory.createForClass(Recommendation);
RecommendationSchema.index({ cropId: 1, region: 1 });
RecommendationSchema.index({ validUntil: 1 });

// ----------------------------------------------------------
// SCHEMA: Alert (Alerte de prix)
// ----------------------------------------------------------
export type AlertDocument = Alert & Document;

@Schema({ timestamps: true, collection: 'alerts' })
export class Alert {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Crop', required: true })
  cropId: Types.ObjectId;

  @Prop({ required: true })
  region: string;

  @Prop({ enum: ['PRICE_UP', 'PRICE_DOWN', 'SELL_NOW', 'PREDICTION_READY'], required: true })
  type: string;

  @Prop({ required: true })
  message: string;

  @Prop()
  messageLocal?: string;

  // Prix qui a déclenché l'alerte
  @Prop()
  triggerPrice?: number;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ default: false })
  isPushSent: boolean;
}

export const AlertSchema = SchemaFactory.createForClass(Alert);
AlertSchema.index({ userId: 1, isRead: 1 });
AlertSchema.index({ createdAt: -1 });
