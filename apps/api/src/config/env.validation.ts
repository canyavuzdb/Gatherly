import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsEmail,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3001;

  @IsUrl({ require_tld: false })
  WEB_ORIGIN = 'http://localhost:3000';

  @IsString()
  @Matches(/^postgres(?:ql)?:\/\//)
  DATABASE_URL!: string;

  @IsString()
  @Matches(/^amqps?:\/\//)
  RABBITMQ_URL!: string;

  @IsString()
  @MinLength(16)
  JWT_SECRET!: string;

  @IsString()
  SMTP_HOST = 'mailpit';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT = 1025;

  @IsEmail()
  SMTP_FROM = 'noreply@gatherly.local';
}

export function validateEnvironment(config: Record<string, unknown>) {
  const environment = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(environment, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  return environment;
}
