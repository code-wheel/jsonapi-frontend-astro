#!/usr/bin/env bash
set -euo pipefail

cd /opt/drupal

# Drush emits deprecation warnings on newer PHP versions; suppress for demo logs.
DRUSH=(
  php
  -d 'error_reporting=E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED'
  ./vendor/bin/drush
  --root=/opt/drupal/web
  --uri=http://localhost
)

DB_URL="${DRUPAL_DB_URL:-mysql://drupal:drupal@db/drupal}"
SITE_NAME="${DRUPAL_SITE_NAME:-JSON:API Frontend Demo}"
ADMIN_USER="${DRUPAL_ADMIN_USER:-admin}"
ADMIN_PASS="${DRUPAL_ADMIN_PASS:-admin}"
ADMIN_MAIL="${DRUPAL_ADMIN_MAIL:-admin@example.com}"
DEMO_PORT="${DEMO_PORT:-8080}"
DEMO_DEPLOYMENT_MODE="${DEMO_DEPLOYMENT_MODE:-split_routing}"
DEMO_DRUPAL_BASE_URL="${DEMO_DRUPAL_BASE_URL:-}"
DEMO_PROXY_SECRET="${DEMO_PROXY_SECRET:-}"
DEMO_ENABLE_LAYOUT="${DEMO_ENABLE_LAYOUT:-1}"
DEMO_ENABLE_MENU="${DEMO_ENABLE_MENU:-1}"
DEMO_ENABLE_WEBFORM="${DEMO_ENABLE_WEBFORM:-1}"
DEMO_RESOLVER_CACHE_MAX_AGE="${DEMO_RESOLVER_CACHE_MAX_AGE:-60}"

echo "[demo] Waiting for database…"
until php -r 'new PDO("mysql:host=db;dbname=drupal", "drupal", "drupal");' >/dev/null 2>&1; do
  sleep 1
done

if [[ ! -f /opt/drupal/web/sites/default/settings.php ]]; then
  echo "[demo] Installing Drupal…"
  "${DRUSH[@]}" -y site:install standard \
    --db-url="$DB_URL" \
    --site-name="$SITE_NAME" \
    --account-name="$ADMIN_USER" \
    --account-pass="$ADMIN_PASS" \
    --account-mail="$ADMIN_MAIL" \
    --site-mail="$ADMIN_MAIL"
else
  echo "[demo] Drupal already installed; applying demo configuration…"
fi

echo "[demo] Installing contrib modules…"

if [[ ! -f /opt/drupal/web/modules/contrib/jsonapi_frontend/jsonapi_frontend.info.yml ]]; then
  composer require drupal/jsonapi_frontend:^1 --no-interaction --no-progress --prefer-dist -W
fi

if [[ "${DEMO_ENABLE_MENU}" == "1" && ! -f /opt/drupal/web/modules/contrib/jsonapi_frontend_menu/jsonapi_frontend_menu.info.yml ]]; then
  composer require drupal/jsonapi_frontend_menu:^1 --no-interaction --no-progress --prefer-dist -W
fi

if [[ "${DEMO_ENABLE_LAYOUT}" == "1" && ! -f /opt/drupal/web/modules/contrib/jsonapi_frontend_layout/jsonapi_frontend_layout.info.yml ]]; then
  composer require drupal/jsonapi_frontend_layout:^1 --no-interaction --no-progress --prefer-dist -W
fi

if [[ "${DEMO_ENABLE_WEBFORM}" == "1" ]]; then
  if [[ ! -f /opt/drupal/web/modules/contrib/webform/webform.info.yml ]]; then
    composer require drupal/webform:^6 --no-interaction --no-progress --prefer-dist -W
  fi
  if [[ ! -f /opt/drupal/web/modules/contrib/jsonapi_frontend_webform/jsonapi_frontend_webform.info.yml ]]; then
    composer require drupal/jsonapi_frontend_webform:^1 --no-interaction --no-progress --prefer-dist -W
  fi
fi

echo "[demo] Enabling required modules…"
"${DRUSH[@]}" -y en jsonapi path_alias jsonapi_frontend

if [[ "${DEMO_ENABLE_MENU}" == "1" ]]; then
  "${DRUSH[@]}" -y en jsonapi_frontend_menu
fi

if [[ "${DEMO_ENABLE_LAYOUT}" == "1" ]]; then
  "${DRUSH[@]}" -y en block contextual layout_builder block_content jsonapi_frontend_layout
fi

if [[ "${DEMO_ENABLE_WEBFORM}" == "1" ]]; then
  "${DRUSH[@]}" -y en webform jsonapi_frontend_webform

  "${DRUSH[@]}" php:eval '
    use Drupal\user\Entity\Role;
    use Drupal\user\RoleInterface;

    $role = Role::load(RoleInterface::ANONYMOUS_ID);
    if ($role && !$role->hasPermission("access webform")) {
      $role->grantPermission("access webform");
      $role->save();
    }
  '
fi

echo "[demo] Configuring jsonapi_frontend demo defaults…"
"${DRUSH[@]}" php:eval '
  $deployment_mode = getenv("DEMO_DEPLOYMENT_MODE") ?: "split_routing";
  $deployment_mode = $deployment_mode === "nextjs_first" ? "nextjs_first" : "split_routing";

  $drupal_base_url = getenv("DEMO_DRUPAL_BASE_URL") ?: "";
  $proxy_secret = getenv("DEMO_PROXY_SECRET") ?: "";
  $cache_max_age = getenv("DEMO_RESOLVER_CACHE_MAX_AGE");
  $cache_max_age = is_string($cache_max_age) && $cache_max_age !== "" ? (int) $cache_max_age : 60;

  $config = \Drupal::configFactory()->getEditable("jsonapi_frontend.settings");
  $config
    ->set("deployment_mode", $deployment_mode)
    ->set("drupal_base_url", $drupal_base_url)
    ->set("proxy_secret", $proxy_secret)
    ->set("resolver.cache_max_age", max(0, $cache_max_age))
    ->set("enable_all", FALSE)
    ->set("headless_bundles", ["node:page"])
    ->save();
'

if [[ "${DEMO_ENABLE_LAYOUT}" == "1" ]]; then
  echo "[demo] Configuring Layout Builder demo display…"
  "${DRUSH[@]}" php:eval '
    use Drupal\layout_builder\Section;
    use Drupal\layout_builder\SectionComponent;

    $storage = \Drupal::entityTypeManager()->getStorage("entity_view_display");
    $display = $storage->load("node.page.default");
    if (!$display || !method_exists($display, "enableLayoutBuilder")) {
      return;
    }

    $display->enableLayoutBuilder();
    $display->setOverridable(FALSE);
    if (method_exists($display, "removeAllSections")) {
      $display->removeAllSections();
    }

    $section = new Section("layout_onecol");
    $section->appendComponent(new SectionComponent("component-title", "content", [
      "id" => "field_block:node:page:title",
      "label" => "Title",
      "label_display" => FALSE,
    ]));
    $section->appendComponent(new SectionComponent("component-body", "content", [
      "id" => "field_block:node:page:body",
      "label" => "Body",
      "label_display" => FALSE,
    ]));
    $display->appendSection($section);
    $display->save();
  '
fi

echo "[demo] Creating sample content…"
"${DRUSH[@]}" php:eval '
  use Drupal\node\Entity\Node;

  // Headless page at /about-us.
  if (!\Drupal::entityQuery("node")->condition("type", "page")->condition("title", "About Us")->accessCheck(FALSE)->execute()) {
    $node = Node::create([
      "type" => "page",
      "title" => "About Us",
      "status" => 1,
      "body" => [
        "value" => "<p>Hello from Drupal JSON:API</p>",
        "format" => "full_html",
      ],
      "path" => ["alias" => "/about-us"],
    ]);
    $node->save();
  }

  // Non-headless article at /non-headless (useful for proxy/redirect demos).
  if (!\Drupal::entityQuery("node")->condition("type", "article")->condition("title", "Non-headless")->accessCheck(FALSE)->execute()) {
    $node = Node::create([
      "type" => "article",
      "title" => "Non-headless",
      "status" => 1,
      "body" => [
        "value" => "<p>This route is intentionally not headless.</p>",
        "format" => "full_html",
      ],
      "path" => ["alias" => "/non-headless"],
    ]);
    $node->save();
  }
'

if [[ "${DEMO_ENABLE_MENU}" == "1" ]]; then
  echo "[demo] Creating menu links…"
  "${DRUSH[@]}" php:eval '
    use Drupal\menu_link_content\Entity\MenuLinkContent;

    $storage = \Drupal::entityTypeManager()->getStorage("menu_link_content");
    $existing = $storage->getQuery()
      ->condition("menu_name", "main")
      ->condition("link.uri", "internal:/about-us")
      ->accessCheck(FALSE)
      ->execute();

    if (!$existing) {
      MenuLinkContent::create([
        "title" => "About Us",
        "link" => ["uri" => "internal:/about-us"],
        "menu_name" => "main",
        "expanded" => TRUE,
        "enabled" => TRUE,
        "weight" => 0,
      ])->save();
    }
  '
fi

if [[ "${DEMO_ENABLE_WEBFORM}" == "1" ]]; then
  echo "[demo] Creating a sample Webform…"
  "${DRUSH[@]}" php:eval '
    if (!\Drupal::moduleHandler()->moduleExists("webform")) {
      return;
    }

    $storage = \Drupal::entityTypeManager()->getStorage("webform");
    if ($storage->load("contact")) {
      return;
    }

    /** @var \Drupal\webform\WebformInterface $webform */
    $webform = $storage->create([
      "id" => "contact",
      "title" => "Contact",
      "elements" => implode("\n", [
        "name:",
        "  '#type': textfield",
        "  '#title': Name",
        "message:",
        "  '#type': textarea",
        "  '#title': Message",
        "actions:",
        "  '#type': webform_actions",
        "  '#submit__label': Send",
      ]),
    ]);
    $webform->save();
  '
fi

echo "[demo] Ready:"
echo "  - Drupal: http://localhost:${DEMO_PORT}"
echo "  - Admin:  ${ADMIN_USER} / ${ADMIN_PASS}"
echo "  - Resolver example:"
echo "      curl \"http://localhost:${DEMO_PORT}/jsonapi/resolve?path=/about-us&_format=json\""

