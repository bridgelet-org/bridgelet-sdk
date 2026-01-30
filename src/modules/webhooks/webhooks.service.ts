import { Injectable } from '@nestjs/common';

@Injectable()
export class WebhooksService {
  public async triggerEvent(): Promise<void> {
    return;
  }
}
