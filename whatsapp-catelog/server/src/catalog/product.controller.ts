import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BulkProductActionDto,
  CreateProductDto,
  ListProductsDto,
  SetPrimaryImageDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductService } from './services/product.service';

type AdminUser = { email: string };

/** Product CRUD, publishing and media. Every route requires an admin JWT. */
@UseGuards(JwtAuthGuard)
@Controller('api/catalog/products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  list(@Query() query: ListProductsDto) {
    return this.products.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AdminUser) {
    return this.products.create(dto, user?.email);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AdminUser) {
    return this.products.update(id, dto, user?.email);
  }

  /** Pushes a draft (or a failed product) to the Meta catalog. */
  @HttpCode(200)
  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() user: AdminUser) {
    return this.products.publish(id, user?.email);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AdminUser) {
    return this.products.remove(id, user?.email);
  }

  @HttpCode(200)
  @Post('bulk')
  bulk(@Body() dto: BulkProductActionDto, @CurrentUser() user: AdminUser) {
    if (!dto.productIds?.length) throw new BadRequestException('Select at least one product.');
    return this.products.bulk(dto.productIds, dto.action, user?.email);
  }

  // -----------------------------------------------------------------------
  // Media
  // -----------------------------------------------------------------------

  @HttpCode(200)
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024, files: 1 } }))
  addImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AdminUser,
  ) {
    if (!file) throw new BadRequestException('An image file is required.');
    return this.products.addImage(id, file, user?.email);
  }

  @HttpCode(200)
  @Post(':id/videos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 128 * 1024 * 1024, files: 1 } }))
  addVideo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AdminUser,
  ) {
    if (!file) throw new BadRequestException('A video file is required.');
    return this.products.addVideo(id, file, user?.email);
  }

  @HttpCode(200)
  @Post(':id/images/primary')
  setPrimaryImage(
    @Param('id') id: string,
    @Body() dto: SetPrimaryImageDto,
    @CurrentUser() user: AdminUser,
  ) {
    return this.products.setPrimaryImage(id, dto.mediaId, user?.email);
  }

  @Delete(':id/media/:mediaId')
  removeMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @CurrentUser() user: AdminUser,
  ) {
    return this.products.removeMedia(id, mediaId, user?.email);
  }
}
