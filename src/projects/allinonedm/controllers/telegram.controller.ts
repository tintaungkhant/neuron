import { Controller, Get, HttpCode } from '@nestjs/common';

@Controller('api/allinonedm/telegram')
export class AllInOneDmTelegramController {
  @Get('webhook')
  @HttpCode(200)
  webhook(): { ok: true } {
    return { ok: true };
  }
}
