/**
 * Portfolio view module — emergency `initialProperties` for Composer / imports.
 * Main UI: `PropertiesDashboard.js` + `PropertiesContext` (uses `getProperties()` fallbacks).
 */
export { initialProperties, ensurePropertyPortfolioImages } from '../../data/initialProperties';
export {
  BAZAAR_BOUTIQUE_HOTEL_IMG,
  DEMO_FIFTEEN_PROPERTY_ORDER,
  PROPERTIES_VIEW_15_UNIQUE_IMAGES,
  PROPERTY_CARD_IMG_BAZAAR,
  PROPERTY_CARD_IMG_WORKSPACE,
  ROOMS_NEVE_TZEDEK_IMG,
  UNIQUE_PROPERTY_IMAGE_POOL,
  WEWORK_SARONA_INDUSTRIAL_IMG,
  applyVarietyToPropertyList,
  pickHeroUrlForCard,
  resolvePropertyCardImage,
} from '../../utils/propertyCardImages';
