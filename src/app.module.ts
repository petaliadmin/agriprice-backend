import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CropsModule } from './modules/crops/crops.module';
import { PricesModule } from './modules/prices/prices.module';
import { PredictionsModule } from './modules/predictions/predictions.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { AlertsModule } from './modules/alerts/alerts.module';

@Module({
  imports: [
    // Configuration globale
    ConfigModule.forRoot({ isGlobal: true }),

    // Connexion MongoDB
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }),
      inject: [ConfigService],
    }),

    // Rate limiting pour éviter les abus
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    // Modules fonctionnels
    AuthModule,
    UsersModule,
    CropsModule,
    PricesModule,
    PredictionsModule,
    RecommendationsModule,
    AlertsModule,
  ],
})
export class AppModule {}
