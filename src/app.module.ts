import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { configuration } from './infrastructure/config';
import { AppController } from './app.controller';
import { DatabaseModule } from './infrastructure/database';
import { EmailModule } from './infrastructure/email/email.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PostsModule } from './modules/posts/posts.module';
import { LocationModule } from './modules/location/location.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttle.ttl') * 1000, // ms
          limit: config.get<number>('throttle.limit'),
        },
      ],
    }),
    DatabaseModule,
    EmailModule,
    AuthModule,
    UsersModule,
    NotificationsModule,
    ReportsModule,
    PostsModule,
    LocationModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
