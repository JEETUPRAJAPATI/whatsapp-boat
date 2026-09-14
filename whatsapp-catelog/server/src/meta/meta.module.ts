import { Global, Module } from '@nestjs/common';
import { MetaBusinessService } from './meta-business.service';
import { MetaCatalogService } from './meta-catalog.service';
import { MetaGraphService } from './meta-graph.service';
import { MetaMessagingService } from './meta-messaging.service';
import { MetaTokenService } from './meta-token.service';

/**
 * Everything that talks to graph.facebook.com.
 *
 * Global so any feature module can inject it without re-importing, but note
 * that no controller is declared here: Meta is never reachable from the
 * browser, only through our own feature endpoints.
 */
@Global()
@Module({
  providers: [
    MetaGraphService,
    MetaTokenService,
    MetaBusinessService,
    MetaCatalogService,
    MetaMessagingService,
  ],
  exports: [
    MetaGraphService,
    MetaTokenService,
    MetaBusinessService,
    MetaCatalogService,
    MetaMessagingService,
  ],
})
export class MetaModule {}
