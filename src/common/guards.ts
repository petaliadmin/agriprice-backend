// =============================================================
// GUARDS & DECORATORS — Contrôle d'accès par rôle
// =============================================================

import {
  Injectable, CanActivate, ExecutionContext,
  SetMetadata, applyDecorators, UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

// ---- Décorateur de rôle ----

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// ---- Guard de rôle ----

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si aucun rôle requis, tout le monde peut accéder
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    return requiredRoles.includes(user.role);
  }
}

// ---- Décorateur combiné Admin ----
// Usage: @AdminOnly() sur une route ou un contrôleur

export function AdminOnly() {
  return applyDecorators(
    Roles('admin'),
    UseGuards(AuthGuard('jwt'), RolesGuard),
  );
}

// ---- Décorateur pour extraire l'utilisateur courant ----

import { createParamDecorator } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// ---- Exemple d'utilisation dans un controller ----
/*
import { AdminOnly, CurrentUser } from '../common/guards';

@Controller('admin/users')
export class AdminUsersController {

  @Get()
  @AdminOnly()  // Seulement les admins
  async getAllUsers(@CurrentUser() user: any) {
    return this.usersService.getAllUsers();
  }

  @Get('stats')
  @AdminOnly()
  async getStats() {
    return this.usersService.getStats();
  }
}
*/
