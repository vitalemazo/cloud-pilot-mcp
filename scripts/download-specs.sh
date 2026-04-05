#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SPECS_DIR="$PROJECT_DIR/specs"

echo "Downloading API specs to $SPECS_DIR"

# ─── AWS (botocore service models) ─────────────��───────────────────────────

AWS_DIR="$SPECS_DIR/aws"
mkdir -p "$AWS_DIR"

# Format: "output_name:botocore_service:version"
AWS_SERVICES=(
  "ec2:ec2:2016-11-15"
  "s3:s3:2006-03-01"
  "iam:iam:2010-05-08"
  "rds:rds:2014-10-31"
  "lambda:lambda:2015-03-31"
  "ecs:ecs:2014-11-13"
  "cloudwatch:cloudwatch:2010-08-01"
  "sts:sts:2011-06-15"
)

BOTOCORE_BASE="https://raw.githubusercontent.com/boto/botocore/develop/botocore/data"

echo ""
echo "=== AWS Botocore Service Models ==="
for entry in "${AWS_SERVICES[@]}"; do
  IFS=':' read -r output_name service version <<< "$entry"
  url="$BOTOCORE_BASE/$service/$version/service-2.json"
  dest="$AWS_DIR/$output_name.json"

  if [ -f "$dest" ]; then
    echo "  [skip] $output_name (already exists)"
  else
    echo "  [fetch] $output_name <- $url"
    if curl -sS -f -o "$dest" "$url"; then
      size=$(wc -c < "$dest" | tr -d ' ')
      echo "          OK (${size} bytes)"
    else
      echo "          FAILED"
      rm -f "$dest"
    fi
  fi
done

# ─── Azure (OpenAPI / Swagger specs) ─────────────────���────────────────────

AZURE_DIR="$SPECS_DIR/azure"
mkdir -p "$AZURE_DIR"

AZURE_BASE="https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/specification"

# Format: "local_name:spec_path_after_specification/"
AZURE_SPECS=(
  "compute:compute/resource-manager/Microsoft.Compute/Compute/stable/2024-07-01/virtualMachine.json"
  "compute-disks:compute/resource-manager/Microsoft.Compute/Compute/stable/2025-01-02/DiskRP.json"
  "storage:storage/resource-manager/Microsoft.Storage/stable/2023-05-01/storage.json"
  "network:network/resource-manager/Microsoft.Network/Network/stable/2025-01-01/virtualNetwork.json"
  "network-lb:network/resource-manager/Microsoft.Network/Network/stable/2025-01-01/loadBalancer.json"
  "network-nsg:network/resource-manager/Microsoft.Network/Network/stable/2025-01-01/networkSecurityGroup.json"
  "sql:sql/resource-manager/Microsoft.Sql/SQL/stable/2025-01-01/Databases.json"
  "web:web/resource-manager/Microsoft.Web/AppService/stable/2024-04-01/WebApps.json"
  "keyvault:keyvault/resource-manager/Microsoft.KeyVault/KeyVault/stable/2024-11-01/keyvault.json"
  "containerservice:containerservice/resource-manager/Microsoft.ContainerService/aks/stable/2024-09-01/managedClusters.json"
  "monitor:monitor/resource-manager/Microsoft.Insights/Insights/stable/2024-02-01/metricDefinitions_API.json"
  "resources:resources/resource-manager/Microsoft.Resources/resources/stable/2024-07-01/resources.json"
)

echo ""
echo "=== Azure OpenAPI Specs ==="
for entry in "${AZURE_SPECS[@]}"; do
  local_name="${entry%%:*}"
  spec_path="${entry#*:}"
  url="$AZURE_BASE/$spec_path"
  dest="$AZURE_DIR/$local_name.json"

  if [ -f "$dest" ]; then
    echo "  [skip] $local_name (already exists)"
  else
    echo "  [fetch] $local_name <- .../${spec_path##*/}"
    if curl -sS -f -o "$dest" "$url"; then
      size=$(wc -c < "$dest" | tr -d ' ')
      echo "          OK (${size} bytes)"
    else
      echo "          FAILED (spec may have moved — check Azure repo)"
      rm -f "$dest"
    fi
  fi
done

# ─── Summary ──────────────────────────────────────────────────────────────

echo ""
echo "=== Summary ==="
echo "AWS specs:   $(ls "$AWS_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo "Azure specs: $(ls "$AZURE_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ') files"
echo ""
echo "Done. Specs are in $SPECS_DIR"
