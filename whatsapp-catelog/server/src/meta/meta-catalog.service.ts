import { Injectable, Logger } from '@nestjs/common';
import { MetaGraphService } from './meta-graph.service';

export interface MetaCatalog {
  id: string;
  name: string;
  vertical?: string;
  product_count?: number;
}

export interface MetaProduct {
  id: string;
  retailer_id: string;
  name?: string;
  description?: string;
  /** Formatted for display, e.g. "₹85,00,000.00" - not a plain number. */
  price?: string;
  sale_price?: string;
  currency?: string;
  availability?: string;
  condition?: string;
  image_url?: string;
  additional_image_urls?: string[];
  url?: string;
  brand?: string;
  category?: string;
  visibility?: string;
  review_status?: { status?: string; rejection_reasons?: string[] };
}

export interface MetaProductSet {
  id: string;
  name: string;
  filter?: unknown;
  product_count?: number;
}

export interface CatalogProductInput {
  retailerId: string;
  name: string;
  description: string;
  /** Major units, e.g. 2500000.00. */
  price: number;
  currency: string;
  availability: string;
  condition: string;
  imageUrl?: string | null;
  additionalImageUrls?: string[];
  url?: string | null;
  brand?: string | null;
  category?: string | null;
  salePrice?: number | null;
}

const PRODUCT_FIELDS = [
  'id',
  'retailer_id',
  'name',
  'description',
  // Note: `price` comes back as a *formatted* string ("₹8,500,000.00"), and
  // there is no numeric equivalent on this edge - parseDisplayPrice handles it.
  'price',
  'sale_price',
  'currency',
  'availability',
  'condition',
  'image_url',
  'additional_image_urls',
  'url',
  'brand',
  'category',
  'visibility',
  'review_status',
].join(',');

/**
 * Currencies with no minor unit. Meta still wants an integer, but for these it
 * is the whole amount rather than hundredths - sending 100x the price would be
 * an expensive bug.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/**
 * The Meta Commerce catalog API.
 *
 * Prices are the one genuinely tricky part: the /products edge takes an
 * integer in the currency's *smallest* unit, while reads come back as a
 * formatted display string. toMinorUnits/fromMinorUnits are the only places
 * that conversion happens.
 */
@Injectable()
export class MetaCatalogService {
  private readonly logger = new Logger('Meta Catalog');

  constructor(private readonly graph: MetaGraphService) {}

  static minorUnitFactor(currency: string): number {
    return ZERO_DECIMAL_CURRENCIES.has(String(currency).toUpperCase()) ? 1 : 100;
  }

  static toMinorUnits(amount: number, currency: string): number {
    return Math.round(Number(amount) * MetaCatalogService.minorUnitFactor(currency));
  }

  static fromMinorUnits(amount: number, currency: string): number {
    return Number(amount) / MetaCatalogService.minorUnitFactor(currency);
  }

  /**
   * Meta returns prices as localised display strings: "₹85,00,000.00" for
   * India, but "8.500.000,00" for a euro locale. Naively stripping everything
   * but digits and dots turns the second into nonsense, so the decimal
   * separator is identified before anything is removed.
   */
  static parseDisplayPrice(product: MetaProduct): number | null {
    const raw = product?.price;
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

    // Drop currency symbols, codes and whitespace (including non-breaking).
    const cleaned = String(raw).replace(/[^\d.,-]/g, '').trim();
    if (!cleaned) return null;

    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    const separator = lastDot > lastComma ? '.' : lastComma > lastDot ? ',' : '';

    let normalized: string;
    if (separator && /^\d{2}$/.test(cleaned.slice(cleaned.lastIndexOf(separator) + 1))) {
      // Exactly two trailing digits: that separator is the decimal point.
      const index = cleaned.lastIndexOf(separator);
      const whole = cleaned.slice(0, index).replace(/[.,]/g, '');
      normalized = `${whole}.${cleaned.slice(index + 1)}`;
    } else {
      // Every separator is thousands grouping.
      normalized = cleaned.replace(/[.,]/g, '');
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // -----------------------------------------------------------------------
  // Catalogs
  // -----------------------------------------------------------------------

  /** Catalogs already connected to a WhatsApp Business Account. */
  async listCatalogsForWaba(token: string, wabaId: string): Promise<MetaCatalog[]> {
    return this.graph.paginate<MetaCatalog>(
      `${wabaId}/product_catalogs`,
      token,
      { fields: 'id,name,vertical,product_count' },
      { context: `list catalogs for WABA ${wabaId}` },
    );
  }

  /** Every catalog the business owns, connected to WhatsApp or not. */
  async listCatalogsForBusiness(token: string, businessId: string): Promise<MetaCatalog[]> {
    return this.graph.paginate<MetaCatalog>(
      `${businessId}/owned_product_catalogs`,
      token,
      { fields: 'id,name,vertical,product_count' },
      { context: `list catalogs for business ${businessId}` },
    );
  }

  async getCatalog(token: string, catalogId: string): Promise<MetaCatalog> {
    return this.graph.get<MetaCatalog>(
      catalogId,
      token,
      { fields: 'id,name,vertical,product_count' },
      `get catalog ${catalogId}`,
    );
  }

  async createCatalog(
    token: string,
    businessId: string,
    name: string,
    vertical = 'commerce',
  ): Promise<{ id: string }> {
    const created = await this.graph.post<{ id: string }>(
      `${businessId}/owned_product_catalogs`,
      token,
      { name, vertical },
      `create catalog for business ${businessId}`,
    );
    this.logger.log(`Created catalog ${created.id} (${name})`);
    return created;
  }

  /** Links an existing catalog to a WABA so it can be used in chat. */
  async connectCatalogToWaba(
    token: string,
    wabaId: string,
    catalogId: string,
  ): Promise<{ success: boolean }> {
    return this.graph.post(
      `${wabaId}/product_catalogs`,
      token,
      { catalog_id: catalogId },
      `connect catalog ${catalogId} to WABA ${wabaId}`,
    );
  }

  async disconnectCatalogFromWaba(
    token: string,
    wabaId: string,
    catalogId: string,
  ): Promise<{ success: boolean }> {
    return this.graph.delete(
      `${wabaId}/product_catalogs`,
      token,
      { catalog_id: catalogId },
      `disconnect catalog ${catalogId} from WABA ${wabaId}`,
    );
  }

  // -----------------------------------------------------------------------
  // Products
  // -----------------------------------------------------------------------

  async listProducts(token: string, catalogId: string): Promise<MetaProduct[]> {
    return this.graph.paginate<MetaProduct>(
      `${catalogId}/products`,
      token,
      { fields: PRODUCT_FIELDS },
      { context: `list products in catalog ${catalogId}`, pageSize: 100 },
    );
  }

  async getProduct(token: string, metaProductId: string): Promise<MetaProduct> {
    return this.graph.get<MetaProduct>(
      metaProductId,
      token,
      { fields: PRODUCT_FIELDS },
      `get product ${metaProductId}`,
    );
  }

  /** Finds a product by our SKU, which is how sync matches the two sides. */
  async findByRetailerId(
    token: string,
    catalogId: string,
    retailerId: string,
  ): Promise<MetaProduct | null> {
    const response = await this.graph.get<{ data?: MetaProduct[] }>(
      `${catalogId}/products`,
      token,
      {
        fields: PRODUCT_FIELDS,
        filter: JSON.stringify({ retailer_id: { eq: retailerId } }),
      },
      `find product ${retailerId}`,
    );
    return response?.data?.[0] || null;
  }

  /**
   * Meta spells these with spaces ("in stock"), our enum uses underscores.
   * Getting this wrong is rejected outright with error 100, so the mapping is
   * explicit rather than a lowercase() and a hope.
   */
  static toMetaAvailability(value: string): string {
    const map: Record<string, string> = {
      IN_STOCK: 'in stock',
      OUT_OF_STOCK: 'out of stock',
      PREORDER: 'preorder',
      AVAILABLE_FOR_ORDER: 'available for order',
      DISCONTINUED: 'discontinued',
    };
    return map[String(value).toUpperCase()] || 'in stock';
  }

  static toMetaCondition(value: string): string {
    const allowed = new Set(['new', 'refurbished', 'used']);
    const normalized = String(value).toLowerCase();
    return allowed.has(normalized) ? normalized : 'new';
  }

  private toGraphPayload(input: CatalogProductInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      retailer_id: input.retailerId,
      name: input.name,
      description: input.description,
      price: MetaCatalogService.toMinorUnits(input.price, input.currency),
      currency: String(input.currency).toUpperCase(),
      availability: MetaCatalogService.toMetaAvailability(input.availability),
      condition: MetaCatalogService.toMetaCondition(input.condition),
    };

    if (input.imageUrl) payload.image_url = input.imageUrl;
    if (input.additionalImageUrls?.length) {
      // Meta accepts up to 10 extra images per item.
      payload.additional_image_urls = input.additionalImageUrls.slice(0, 10);
    }
    if (input.url) payload.url = input.url;
    if (input.brand) payload.brand = input.brand;
    if (input.category) payload.category = input.category;
    if (input.salePrice !== null && input.salePrice !== undefined) {
      payload.sale_price = MetaCatalogService.toMinorUnits(input.salePrice, input.currency);
    }

    return payload;
  }

  async createProduct(
    token: string,
    catalogId: string,
    input: CatalogProductInput,
  ): Promise<{ id: string }> {
    const created = await this.graph.post<{ id: string }>(
      `${catalogId}/products`,
      token,
      this.toGraphPayload(input),
      `create product ${input.retailerId}`,
    );
    this.logger.log(`Created Meta product ${created.id} (${input.retailerId})`);
    return created;
  }

  /** Updates in place. Meta uses POST on the product id, not PUT. */
  async updateProduct(
    token: string,
    metaProductId: string,
    input: CatalogProductInput,
  ): Promise<{ success: boolean }> {
    const payload = this.toGraphPayload(input);
    // retailer_id is immutable once assigned; sending it back is rejected.
    delete payload.retailer_id;

    const result = await this.graph.post<{ success: boolean }>(
      metaProductId,
      token,
      payload,
      `update product ${metaProductId}`,
    );
    this.logger.log(`Updated Meta product ${metaProductId}`);
    return result;
  }

  async deleteProduct(token: string, metaProductId: string): Promise<{ success: boolean }> {
    const result = await this.graph.delete<{ success: boolean }>(
      metaProductId,
      token,
      undefined,
      `delete product ${metaProductId}`,
    );
    this.logger.log(`Deleted Meta product ${metaProductId}`);
    return result;
  }

  /**
   * Batch upsert/delete - one request for many items.
   *
   * Meta processes a batch asynchronously and returns handles, so this is used
   * for bulk operations where per-item confirmation is not needed. Single
   * product edits use createProduct/updateProduct so the caller gets an
   * immediate, per-item verdict.
   */
  async itemsBatch(
    token: string,
    catalogId: string,
    requests: Array<{ method: 'UPDATE' | 'DELETE'; data: Record<string, unknown> }>,
  ): Promise<{ handles?: string[] }> {
    return this.graph.post(
      `${catalogId}/items_batch`,
      token,
      {
        item_type: 'PRODUCT_ITEM',
        requests: JSON.stringify(requests),
      },
      `items batch (${requests.length} items) in catalog ${catalogId}`,
    );
  }

  // -----------------------------------------------------------------------
  // Product sets (collections)
  // -----------------------------------------------------------------------

  async listProductSets(token: string, catalogId: string): Promise<MetaProductSet[]> {
    return this.graph.paginate<MetaProductSet>(
      `${catalogId}/product_sets`,
      token,
      { fields: 'id,name,filter,product_count' },
      { context: `list product sets in ${catalogId}` },
    );
  }

  /**
   * Meta product sets are filter-based, so a hand-picked collection is
   * expressed as "retailer_id is any of [...]".
   */
  static retailerIdFilter(retailerIds: string[]): Record<string, unknown> {
    return { retailer_id: { is_any: retailerIds } };
  }

  async createProductSet(
    token: string,
    catalogId: string,
    name: string,
    filter: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const created = await this.graph.post<{ id: string }>(
      `${catalogId}/product_sets`,
      token,
      { name, filter: JSON.stringify(filter) },
      `create product set ${name}`,
    );
    this.logger.log(`Created Meta product set ${created.id} (${name})`);
    return created;
  }

  async updateProductSet(
    token: string,
    productSetId: string,
    updates: { name?: string; filter?: Record<string, unknown> },
  ): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {};
    if (updates.name) body.name = updates.name;
    if (updates.filter) body.filter = JSON.stringify(updates.filter);

    return this.graph.post(productSetId, token, body, `update product set ${productSetId}`);
  }

  async deleteProductSet(token: string, productSetId: string): Promise<{ success: boolean }> {
    return this.graph.delete(
      productSetId,
      token,
      undefined,
      `delete product set ${productSetId}`,
    );
  }
}
