import { Subscrio, OverrideType } from '../src/index.js';
import { loadConfig } from './config.js';
import { sql } from 'drizzle-orm';

// Global interactive mode flag
let isInteractiveMode = false;

// ═══════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════

async function main() {
  const config = loadConfig();
  printHeader(config.database.connectionString);
  
  // Check for command line arguments
  const args = process.argv.slice(2);
  const isAutomated = args.includes('--automated') || args.includes('-a');
  const shouldRecreate = args.includes('--recreate') || args.includes('-r');
  
  // Prompt for demo start with options (unless automated)
  const choice = await promptDemoStart(isAutomated);
  
  if (choice === 'q') {
    console.log('Demo cancelled by user.');
    process.exit(0);
  }
  
  // Set interactive mode based on user choice (but never in automated mode)
  isInteractiveMode = !isAutomated && choice === 'i';
  
  const subscrio = new Subscrio(config);

  try {
    // Drop and recreate schema if requested
    if (shouldRecreate) {
      console.log('\n🔄 Dropping and recreating Subscrio tables...');
      await subscrio.dropSchema();
      console.log('✅ Tables dropped successfully');
    } else {
      await cleanupDemoEntities(subscrio);
    }
    
    await runPhase1_SystemSetup(subscrio);
    await runPhase2_TrialStart(subscrio);
    await runPhase3_TrialToPurchase(subscrio);
    await runPhase4_PlanUpgrade(subscrio);
    await runPhase5_FeatureOverrides(subscrio);
    await runPhase6_SubscriptionRenewal(subscrio);
    await runPhase7_DowngradeToFree(subscrio);
    await runPhase8_Summary();
  } catch (error) {
    console.error('\n❌ Error during demo execution:');
    console.error(error);
    process.exit(1);
  } finally {
    await subscrio.close();
    console.log('Database connections closed.\n');
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════
// PHASE METHODS (in order of execution)
// ═══════════════════════════════════════════════════════════

async function runPhase1_SystemSetup(subscrio: Subscrio) {
  printPhase(1, 'System Setup');

  // Step 1: Install schema
  printStep(1, 'Install Database Schema');
  await subscrio.installSchema();
    printSuccess('Database schema installed successfully');
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 1: System Setup', 'Step 1: Schema Installation');
  }

  await sleep(500);

  // Step 2: Create product
  printStep(2, 'Create Product');
  printInfo('Creating the main product for our SaaS platform', 1);
  
  console.log('📥 Input: subscrio.products.createProduct({');
  console.log('  key: "projecthub",');
  console.log('  displayName: "ProjectHub",');
  console.log('  description: "A modern project management platform"');
  console.log('})');
  
  const product = await subscrio.products.createProduct({
    key: 'projecthub',
    displayName: 'ProjectHub',
    description: 'A modern project management platform'
  });
  printSuccess(`Product created: ${product.displayName} (${product.key})`);
  
  // Verify creation by fetching the product
  console.log('📥 Input: subscrio.products.getProduct("projecthub")');
  const fetchedProduct = await subscrio.products.getProduct(product.key);
  console.log('📄 Output: Product DTO:', JSON.stringify(fetchedProduct, null, 2));
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 1: System Setup', 'Step 2: Product Creation Complete');
  }

  await sleep(500);

  // Step 3: Create features
  printStep(3, 'Create Features');

  const features = [
    {
      key: 'max-projects',
      displayName: 'Max Projects',
      valueType: 'numeric' as const,
      defaultValue: '3',
      description: 'Maximum number of projects'
    },
    {
      key: 'max-users-per-project',
      displayName: 'Max Users Per Project',
      valueType: 'numeric' as const,
      defaultValue: '5',
      description: 'Maximum users per project'
    },
    {
      key: 'gantt-charts',
      displayName: 'Gantt Charts',
      valueType: 'toggle' as const,
      defaultValue: 'false',
      description: 'Advanced Gantt chart visualization'
    },
    {
      key: 'custom-branding',
      displayName: 'Custom Branding',
      valueType: 'toggle' as const,
      defaultValue: 'false',
      description: 'White-label branding options'
    },
    {
      key: 'api-access',
      displayName: 'API Access',
      valueType: 'toggle' as const,
      defaultValue: 'false',
      description: 'REST API access'
    }
  ];

  for (const featureData of features) {
    console.log(`📥 Input: subscrio.features.createFeature(${JSON.stringify(featureData, null, 2)})`);
    const feature = await subscrio.features.createFeature(featureData);
    
    console.log(`📥 Input: subscrio.products.associateFeature("projecthub", "${feature.key}")`);
    await subscrio.products.associateFeature('projecthub', feature.key);
    printSuccess(`Created feature: ${feature.displayName} (${feature.key})`);
    
    // Verify creation by fetching the feature
    console.log(`📥 Input: subscrio.features.getFeature("${feature.key}")`);
    const fetchedFeature = await subscrio.features.getFeature(feature.key);
    console.log(`📄 Output: Feature DTO (${feature.key}):`, JSON.stringify(fetchedFeature, null, 2));
  }
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 1: System Setup', 'Step 3: Features Creation Complete');
  }

  await sleep(500);

  // Step 4: Create plans
  printStep(4, 'Create Plans with Billing Cycles');
  printInfo('Create each plan with its billing cycles and optional transition configuration', 1);

  // Free Plan (with forever billing cycle for transitions)
  console.log('📥 Input: subscrio.plans.createPlan({');
  console.log('  productKey: "projecthub",');
  console.log('  key: "free",');
  console.log('  displayName: "Free Plan",');
  console.log('  description: "Perfect for individuals and small teams"');
  console.log('})');
  
  const freePlan = await subscrio.plans.createPlan({
    productKey: 'projecthub',
    key: 'free',
    displayName: 'Free Plan',
    description: 'Perfect for individuals and small teams'
  });
  printSuccess(`Created plan: ${freePlan.displayName} (${freePlan.key})`);
  
  // Create only the forever billing cycle for free plan (used for downgrades later)
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "free",');
  console.log('  key: "free-forever",');
  console.log('  displayName: "Forever",');
  console.log('  description: "Never-ending free access",');
  console.log('  durationUnit: "forever"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'free',
    key: 'free-forever',
    displayName: 'Forever',
    description: 'Never-ending free access',
    durationUnit: 'forever'
  });
  
  console.log('📥 Input: subscrio.plans.getPlan("free")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("free-forever")');
  console.log(`📄 Output: Free Plan DTO:`, JSON.stringify(await subscrio.plans.getPlan('free'), null, 2));
  console.log(`📄 Output: Free Forever Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('free-forever'), null, 2));

  // Starter Plan (with transition to free-forever)
  console.log('📥 Input: subscrio.plans.createPlan({');
  console.log('  productKey: "projecthub",');
  console.log('  key: "starter",');
  console.log('  displayName: "Starter Plan",');
  console.log('  description: "For growing teams",');
  console.log('  onExpireTransitionToBillingCycleKey: "free-forever"');
  console.log('})');
  
  const starterPlan = await subscrio.plans.createPlan({
    productKey: 'projecthub',
    key: 'starter',
    displayName: 'Starter Plan',
    description: 'For growing teams',
    onExpireTransitionToBillingCycleKey: 'free-forever'
  });
  printSuccess(`Created plan: ${starterPlan.displayName} (${starterPlan.key}) with auto-transition to free plan`);
  
  // Create billing cycles for starter plan
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "starter",');
  console.log('  key: "starter-monthly",');
  console.log('  displayName: "Monthly",');
  console.log('  durationValue: 1,');
  console.log('  durationUnit: "months"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'starter',
    key: 'starter-monthly',
    displayName: 'Monthly',
    durationValue: 1,
    durationUnit: 'months'
  });
  
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "starter",');
  console.log('  key: "starter-annual",');
  console.log('  displayName: "Annual",');
  console.log('  durationValue: 1,');
  console.log('  durationUnit: "years"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'starter',
    key: 'starter-annual',
    displayName: 'Annual',
    durationValue: 1,
    durationUnit: 'years'
  });
  
  console.log('📥 Input: subscrio.plans.getPlan("starter")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("starter-monthly")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("starter-annual")');
  console.log(`📄 Output: Starter Plan DTO:`, JSON.stringify(await subscrio.plans.getPlan('starter'), null, 2));
  console.log(`📄 Output: Starter Monthly Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('starter-monthly'), null, 2));
  console.log(`📄 Output: Starter Annual Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('starter-annual'), null, 2));

  // Professional Plan (with transition to free-forever)
  console.log('📥 Input: subscrio.plans.createPlan({');
  console.log('  productKey: "projecthub",');
  console.log('  key: "professional",');
  console.log('  displayName: "Professional Plan",');
  console.log('  description: "For established businesses",');
  console.log('  onExpireTransitionToBillingCycleKey: "free-forever"');
  console.log('})');
  
  const professionalPlan = await subscrio.plans.createPlan({
    productKey: 'projecthub',
    key: 'professional',
    displayName: 'Professional Plan',
    description: 'For established businesses',
    onExpireTransitionToBillingCycleKey: 'free-forever'
  });
  printSuccess(`Created plan: ${professionalPlan.displayName} (${professionalPlan.key}) with auto-transition to free plan`);
  
  // Create billing cycles for professional plan
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "professional",');
  console.log('  key: "professional-monthly",');
  console.log('  displayName: "Monthly",');
  console.log('  durationValue: 1,');
  console.log('  durationUnit: "months"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'professional',
    key: 'professional-monthly',
    displayName: 'Monthly',
    durationValue: 1,
    durationUnit: 'months'
  });
  
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "professional",');
  console.log('  key: "professional-annual",');
  console.log('  displayName: "Annual",');
  console.log('  durationValue: 1,');
  console.log('  durationUnit: "years"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'professional',
    key: 'professional-annual',
    displayName: 'Annual',
    durationValue: 1,
    durationUnit: 'years'
  });
  
  console.log('📥 Input: subscrio.plans.getPlan("professional")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("professional-monthly")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("professional-annual")');
  console.log(`📄 Output: Professional Plan DTO:`, JSON.stringify(await subscrio.plans.getPlan('professional'), null, 2));
  console.log(`📄 Output: Professional Monthly Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('professional-monthly'), null, 2));
  console.log(`📄 Output: Professional Annual Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('professional-annual'), null, 2));

  // Enterprise Plan (with transition to free-forever)
  console.log('📥 Input: subscrio.plans.createPlan({');
  console.log('  productKey: "projecthub",');
  console.log('  key: "enterprise",');
  console.log('  displayName: "Enterprise Plan",');
  console.log('  description: "For large organizations",');
  console.log('  onExpireTransitionToBillingCycleKey: "free-forever"');
  console.log('})');
  
  const enterprisePlan = await subscrio.plans.createPlan({
    productKey: 'projecthub',
    key: 'enterprise',
    displayName: 'Enterprise Plan',
    description: 'For large organizations',
    onExpireTransitionToBillingCycleKey: 'free-forever'
  });
  printSuccess(`Created plan: ${enterprisePlan.displayName} (${enterprisePlan.key}) with auto-transition to free plan`);
  
  // Create billing cycles for enterprise plan
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "enterprise",');
  console.log('  key: "enterprise-monthly",');
  console.log('  displayName: "Monthly",');
  console.log('  durationValue: 1,');
  console.log('  durationUnit: "months"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'enterprise',
    key: 'enterprise-monthly',
    displayName: 'Monthly',
    durationValue: 1,
    durationUnit: 'months'
  });
  
  console.log('📥 Input: subscrio.billingCycles.createBillingCycle({');
  console.log('  planKey: "enterprise",');
  console.log('  key: "enterprise-annual",');
  console.log('  displayName: "Annual",');
  console.log('  durationValue: 1,');
  console.log('  durationUnit: "years"');
  console.log('})');
  
  await subscrio.billingCycles.createBillingCycle({
    planKey: 'enterprise',
    key: 'enterprise-annual',
    displayName: 'Annual',
    durationValue: 1,
    durationUnit: 'years'
  });
  
  console.log('📥 Input: subscrio.plans.getPlan("enterprise")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("enterprise-monthly")');
  console.log('📥 Input: subscrio.billingCycles.getBillingCycle("enterprise-annual")');
  console.log(`📄 Output: Enterprise Plan DTO:`, JSON.stringify(await subscrio.plans.getPlan('enterprise'), null, 2));
  console.log(`📄 Output: Enterprise Monthly Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('enterprise-monthly'), null, 2));
  console.log(`📄 Output: Enterprise Annual Billing Cycle DTO:`, JSON.stringify(await subscrio.billingCycles.getBillingCycle('enterprise-annual'), null, 2));
  
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 1: System Setup', 'Step 4: Plans Creation Complete');
  }

  // Set feature values for all plans
  printInfo('Configure feature limits and capabilities for each plan', 1);
  
  // Free plan: basic limits
  await subscrio.plans.setFeatureValue('free', 'max-projects', '1');
  await subscrio.plans.setFeatureValue('free', 'max-users-per-project', '3');
  printSuccess('Free plan: 1 project, 3 users per project');

  // Starter plan: moderate limits
  await subscrio.plans.setFeatureValue('starter', 'max-projects', '5');
  await subscrio.plans.setFeatureValue('starter', 'max-users-per-project', '10');
  printSuccess('Starter plan: 5 projects, 10 users per project');

  // Professional plan: higher limits + gantt charts
  await subscrio.plans.setFeatureValue('professional', 'max-projects', '25');
  await subscrio.plans.setFeatureValue('professional', 'max-users-per-project', '50');
  await subscrio.plans.setFeatureValue('professional', 'gantt-charts', 'true');
  printSuccess('Professional plan: 25 projects, 50 users per project, Gantt charts enabled');

  // Enterprise plan: unlimited + all features
  await subscrio.plans.setFeatureValue('enterprise', 'max-projects', '999999');
  await subscrio.plans.setFeatureValue('enterprise', 'max-users-per-project', '999999');
  await subscrio.plans.setFeatureValue('enterprise', 'gantt-charts', 'true');
  await subscrio.plans.setFeatureValue('enterprise', 'custom-branding', 'true');
  await subscrio.plans.setFeatureValue('enterprise', 'api-access', 'true');
  printSuccess('Enterprise plan: 999,999 projects/users, all features enabled');

  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 1: System Setup', 'Step 4: Plans, Billing Cycles, and Transitions Complete');
  }
}

async function runPhase2_TrialStart(subscrio: Subscrio) {
  printPhase(2, 'Trial Start');

  // Step 1: Create customer
  printStep(1, 'Create Customer');
  printInfo('Customer signs up for the platform', 1);
  
  console.log('📥 Input: subscrio.customers.createCustomer({');
  console.log('  key: "acme-corp",');
  console.log('  displayName: "Acme Corporation",');
  console.log('  email: "admin@acme-corp.com"');
  console.log('})');
  
  const customer = await subscrio.customers.createCustomer({
    key: 'acme-corp',
    displayName: 'Acme Corporation',
    email: 'admin@acme-corp.com'
  });
  printSuccess(`Customer created: ${customer.displayName} (${customer.key})`);
  
  // Verify creation by fetching the customer
  console.log('📥 Input: subscrio.customers.getCustomer("acme-corp")');
  const fetchedCustomer = await subscrio.customers.getCustomer(customer.key);
  console.log('📄 Output: Customer DTO:', JSON.stringify(fetchedCustomer, null, 2));
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 2: Customer Onboarding', 'Step 1: Customer Creation Complete');
  }

  await sleep(500);

  // Step 2: Create trial subscription
  printStep(2, 'Create Trial Subscription');
  printInfo('Customer starts with a 14-day trial on the starter plan', 1);

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);

  // 🚀 OPTIMIZED API: Only need customerKey and billingCycleKey
  // The plan and product are automatically derived from the billing cycle
  console.log('📥 Input: subscrio.subscriptions.createSubscription({');
  console.log('  customerKey: "acme-corp",');
  console.log('  billingCycleKey: "starter-monthly",');
  console.log('  key: "acme-subscription",');
  console.log('  trialEndDate: "' + trialEnd.toISOString() + '"');
  console.log('})');
  
  const subscription = await subscrio.subscriptions.createSubscription({
    customerKey: customer.key,
    billingCycleKey: 'starter-monthly',  // Plan and product derived automatically
    key: 'acme-subscription',
    trialEndDate: trialEnd.toISOString()
  });
  printSuccess(`Trial subscription created: ${subscription.key}`);
  
  // Verify creation by fetching the subscription
  console.log('📥 Input: subscrio.subscriptions.getSubscription("acme-subscription")');
  const fetchedSubscription = await subscrio.subscriptions.getSubscription(subscription.key);
  console.log('📄 Output: Trial Subscription DTO:', JSON.stringify(fetchedSubscription, null, 2));

  printInfo(`Plan: ${subscription.planKey}`, 1);
  printInfo(`Status: ${subscription.status}`, 1);
  printInfo(`Trial ends: ${trialEnd.toLocaleDateString()}`, 1);
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 2: Customer Onboarding', 'Step 2: Trial Subscription Creation Complete');
  }

  await sleep(500);

  // Step 3: Check feature access
  printStep(3, 'Check Feature Access');
  printInfo('Verify customer has access to starter plan features', 1);

  const customerKey = customer.key;

  // Check numeric features
  const maxProjects = await subscrio.featureChecker.getValueForCustomer(customerKey, 'projecthub', 'max-projects');
  const maxUsers = await subscrio.featureChecker.getValueForCustomer(customerKey, 'projecthub', 'max-users-per-project');
  
  printSuccess(`Max projects: ${maxProjects}`);
  printSuccess(`Max users per project: ${maxUsers}`);

  // Check toggle features
  const hasGanttCharts = await subscrio.featureChecker.isEnabledForCustomer(customerKey, 'projecthub', 'gantt-charts');
  const hasCustomBranding = await subscrio.featureChecker.isEnabledForCustomer(customerKey, 'projecthub', 'custom-branding');
  const hasApiAccess = await subscrio.featureChecker.isEnabledForCustomer(customerKey, 'projecthub', 'api-access');
  
  printInfo(`Gantt charts: ${hasGanttCharts ? 'Enabled' : 'Disabled'}`, 1);
  printInfo(`Custom branding: ${hasCustomBranding ? 'Enabled' : 'Disabled'}`, 1);
  printInfo(`API access: ${hasApiAccess ? 'Enabled' : 'Disabled'}`, 1);
  
  // Show resolved feature values
  console.log('📄 Resolved Feature Values:', JSON.stringify({
    maxProjects,
    maxUsers,
    hasGanttCharts,
    hasCustomBranding,
    hasApiAccess
  }, null, 2));

  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 2: Customer Onboarding', 'Step 3: Feature Access Verification Complete');
  }

  await sleep(500);
}

async function runPhase3_TrialToPurchase(subscrio: Subscrio) {
  printPhase(3, 'Trial to Purchase');
  
  // Step 1: Trial converts to paid subscription
  printStep(1, 'Trial Converts to Paid Subscription');
  printInfo('Customer decides to continue after trial period', 1);

  // Convert the trial subscription to active (trial conversion)
  console.log('📥 Input: subscrio.subscriptions.updateSubscription("acme-subscription", {');
  console.log('  clearTrialEndDate: true');
  console.log('})');
  
  await subscrio.subscriptions.updateSubscription('acme-subscription', {
    clearTrialEndDate: true
  });

  printSuccess('Trial subscription converted to active paid subscription');
  
  // Verify the conversion by fetching the updated subscription
  console.log('📥 Input: subscrio.subscriptions.getSubscription("acme-subscription")');
  const convertedSubscription = await subscrio.subscriptions.getSubscription('acme-subscription');
  console.log('📄 Output: Converted Subscription DTO:', JSON.stringify(convertedSubscription, null, 2));

  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 3: Trial to Purchase', 'Step 1: Trial Conversion Complete');
  }

  await sleep(500);
}

async function runPhase4_PlanUpgrade(subscrio: Subscrio) {
  printPhase(4, 'Plan Upgrade');

  // Step 1: Upgrade existing subscription to professional plan
  printStep(1, 'Upgrade to Professional Plan');
  printInfo('Customer upgrades from starter to professional plan', 1);
  
  // Update the existing subscription to professional plan
  console.log('📥 Input: subscrio.subscriptions.updateSubscription("acme-subscription", {');
  console.log('  billingCycleKey: "professional-monthly"');
  console.log('})');
  
  await subscrio.subscriptions.updateSubscription('acme-subscription', {
    billingCycleKey: 'professional-monthly'  // This will automatically update the plan
  });
  
  printSuccess('Subscription upgraded to professional plan');
  
  // Verify the upgrade by fetching the updated subscription
  console.log('📥 Input: subscrio.subscriptions.getSubscription("acme-subscription")');
  const upgradedSubscription = await subscrio.subscriptions.getSubscription('acme-subscription');
  if (upgradedSubscription) {
    console.log('📄 Output: Upgraded Subscription DTO:', JSON.stringify(upgradedSubscription, null, 2));
    printInfo(`Plan: ${upgradedSubscription.planKey}`, 1);
    printInfo(`Status: ${upgradedSubscription.status}`, 1);
  }
  
  printDivider();

  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 4: Plan Upgrade', 'Step 1: Plan Upgraded');
  }

  await sleep(500);
}

async function runPhase5_FeatureOverrides(subscrio: Subscrio) {
  printPhase(5, 'Feature Overrides');
  
  // Step 1: Add temporary override
  printStep(1, 'Add Temporary Override');
  printInfo('Customer requests temporary increase in project limit', 1);

  console.log('📥 Input: subscrio.subscriptions.addFeatureOverride(');
  console.log('  "acme-subscription",');
  console.log('  "max-projects",');
  console.log('  "10",');
  console.log('  OverrideType.Temporary');
  console.log(')');
  
  await subscrio.subscriptions.addFeatureOverride(
    'acme-subscription',
    'max-projects',
    '10',  // Increase from 5 to 10
    OverrideType.Temporary
  );

  printSuccess('Added temporary override: max-projects = 10');
  
  // Show the feature override that was added
  console.log('📄 Output: Feature Override Added:', JSON.stringify({
    subscriptionKey: 'acme-subscription',
    featureKey: 'max-projects',
    value: '10',
    type: 'temporary',
    description: 'Temporary increase in project limit'
  }, null, 2));
  
  // Verify the override
  const maxProjects = await subscrio.featureChecker.getValueForCustomer('acme-corp', 'projecthub', 'max-projects');
  printInfo(`Current max projects: ${maxProjects}`, 1);
  
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 5: Feature Overrides', 'Step 1: Temporary Override Added');
  }

  await sleep(500);

  // Step 2: Add permanent override
  printStep(2, 'Add Permanent Override');
  printInfo('Customer purchases add-on for Gantt charts', 1);
  
  console.log('📥 Input: subscrio.subscriptions.addFeatureOverride(');
  console.log('  "acme-subscription",');
  console.log('  "gantt-charts",');
  console.log('  "true",');
  console.log('  OverrideType.Permanent');
  console.log(')');
  
  await subscrio.subscriptions.addFeatureOverride(
    'acme-subscription',
    'gantt-charts',
    'true',
    OverrideType.Permanent
  );
  
  printSuccess('Added permanent override: gantt-charts = true');
  
  // Show the feature override that was added
  console.log('📄 Output: Feature Override Added:', JSON.stringify({
    subscriptionKey: 'acme-subscription',
    featureKey: 'gantt-charts',
    value: 'true',
    type: 'permanent',
    description: 'Permanent add-on for Gantt charts'
  }, null, 2));
  
  // Verify the override
  const hasGanttCharts = await subscrio.featureChecker.isEnabledForCustomer('acme-corp', 'projecthub', 'gantt-charts');
  printInfo(`Gantt charts enabled: ${hasGanttCharts}`, 1);
  
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 5: Feature Overrides', 'Step 2: Permanent Override Added');
  }

  await sleep(500);
}

async function runPhase6_SubscriptionRenewal(subscrio: Subscrio) {
  printPhase(6, 'Subscription Renewal');
  
  // Step 1: Process subscription renewal
  printStep(1, 'Process Subscription Renewal');
  printInfo('Subscription renews - temporary overrides are cleared, permanent ones remain', 1);
  
  // Clear temporary overrides (simulating renewal)
  console.log('📥 Input: subscrio.subscriptions.clearTemporaryOverrides("acme-subscription")');
  await subscrio.subscriptions.clearTemporaryOverrides('acme-subscription');
  printSuccess('Temporary overrides cleared during renewal');
  
  // Get the renewed subscription
  console.log('📥 Input: subscrio.subscriptions.getSubscription("acme-subscription")');
  const renewedSubscription = await subscrio.subscriptions.getSubscription('acme-subscription');
  console.log('📄 Output: Renewed Subscription DTO:', JSON.stringify(renewedSubscription, null, 2));
  
  // Check feature resolution after renewal
  const maxProjects = await subscrio.featureChecker.getValueForCustomer('acme-corp', 'projecthub', 'max-projects');
  const hasGanttCharts = await subscrio.featureChecker.isEnabledForCustomer('acme-corp', 'projecthub', 'gantt-charts');
  
  printInfo(`Max projects: ${maxProjects} (back to plan default)`, 1);
  printInfo(`Gantt charts: ${hasGanttCharts ? 'Enabled' : 'Disabled'} (permanent override remains)`, 1);
  
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 6: Subscription Renewal', 'Step 1: Renewal Processed');
  }

  await sleep(500);
}

async function runPhase7_DowngradeToFree(subscrio: Subscrio) {
  printPhase(7, 'Customer Cancellation and Downgrade');
  
  // Step 1: Customer cancels subscription
  printStep(1, 'Customer Cancels Subscription');
  printInfo('Customer cancels professional subscription - status changes to cancellation_pending but remains active until period end', 1);
  
  // Cancel the subscription by setting cancellation date
  const cancellationDate = new Date();
  console.log('📥 Input: subscrio.subscriptions.updateSubscription("acme-subscription", {');
  console.log('  cancellationDate: "' + cancellationDate.toISOString() + '"');
  console.log('})');
  
  await subscrio.subscriptions.updateSubscription('acme-subscription', {
    cancellationDate: cancellationDate.toISOString()
  });
  printSuccess('Professional subscription cancelled by customer');
  
  // Verify the cancelled subscription
  console.log('📥 Input: subscrio.subscriptions.getSubscription("acme-subscription")');
  const cancelledSubscription = await subscrio.subscriptions.getSubscription('acme-subscription');
  if (cancelledSubscription) {
    console.log('📄 Output: Cancelled Subscription DTO:', JSON.stringify(cancelledSubscription, null, 2));
    printInfo(`Status: ${cancelledSubscription.status}`, 1);
    printInfo(`Cancellation date: ${cancelledSubscription.cancellationDate ? new Date(cancelledSubscription.cancellationDate).toLocaleDateString() : 'N/A'}`, 1);
    printInfo(`Current period end: ${cancelledSubscription.currentPeriodEnd ? new Date(cancelledSubscription.currentPeriodEnd).toLocaleDateString() : 'N/A'}`, 1);
    printInfo(`Note: Subscription remains active until period end date (cancellation_pending status)`, 1);
  }
  
  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 7: Customer Cancellation', 'Step 1: Subscription Cancelled');
  }

  await sleep(500);

  // Step 2: Customer opts into the free plan manually after cancellation
  printStep(2, 'Customer Starts Free Plan');
  printInfo('After the paid plan lapses, the customer opts into the free tier manually', 1);

  console.log('📥 Input: subscrio.subscriptions.createSubscription({');
  console.log('  customerKey: "acme-corp",');
  console.log('  billingCycleKey: "free-forever",');
  console.log('  key: "acme-free-subscription"');
  console.log('})');

  const freeSubscription = await subscrio.subscriptions.createSubscription({
    customerKey: 'acme-corp',
    billingCycleKey: 'free-forever',
    key: 'acme-free-subscription'
  });
  printSuccess('Free plan subscription created for the customer');

  console.log('📄 Output: Free Subscription DTO:', JSON.stringify(freeSubscription, null, 2));

  printDivider();

  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 7: Customer Downgrade', 'Step 2: Free Plan Subscription Created');
  }

  await sleep(500);
  
  // Step 3: Check free plan feature access
  printStep(3, 'Check Free Plan Feature Access');
  printInfo('Verify customer has access to free plan features after downgrading', 1);

  // Check actual feature values for the new free subscription
  const maxProjects = await subscrio.featureChecker.getValueForCustomer('acme-corp', 'projecthub', 'max-projects');
  const maxUsers = await subscrio.featureChecker.getValueForCustomer('acme-corp', 'projecthub', 'max-users-per-project');
  const hasGanttCharts = await subscrio.featureChecker.isEnabledForCustomer('acme-corp', 'projecthub', 'gantt-charts');
  const hasCustomBranding = await subscrio.featureChecker.isEnabledForCustomer('acme-corp', 'projecthub', 'custom-branding');
  const hasApiAccess = await subscrio.featureChecker.isEnabledForCustomer('acme-corp', 'projecthub', 'api-access');

  printSuccess(`Max projects: ${maxProjects} (free plan limit)`);
  printSuccess(`Max users per project: ${maxUsers} (free plan limit)`);
  printInfo(`Gantt charts: ${hasGanttCharts ? 'Enabled' : 'Disabled'} (not available on free plan)`, 1);
  printInfo(`Custom branding: ${hasCustomBranding ? 'Enabled' : 'Disabled'} (not available on free plan)`, 1);
  printInfo(`API access: ${hasApiAccess ? 'Enabled' : 'Disabled'} (not available on free plan)`, 1);
  
  // Show resolved feature values
  console.log('📄 Output: Resolved Feature Values (Free Plan):', JSON.stringify({
    maxProjects,
    maxUsers,
    hasGanttCharts,
    hasCustomBranding,
    hasApiAccess
  }, null, 2));

  printDivider();
  
  if (isInteractiveMode) {
    await promptForDatabaseInspection('Phase 7: Customer Downgrade', 'Step 3: Free Plan Features Verified');
  }

  await sleep(500);
}

async function runPhase8_Summary() {
  printPhase(7, 'Summary');
  
  console.log('🎉 Demo completed successfully!');
  console.log('');
  console.log('This demo showcased a realistic subscription lifecycle:');
  console.log('• Product and feature management');
  console.log('• Plan configuration with feature values');
  console.log('• Customer onboarding with trial subscription');
  console.log('• Trial conversion to paid subscription');
  console.log('• Plan upgrades within the same subscription');
  console.log('• Feature overrides (temporary and permanent)');
  console.log('• Subscription renewal and override lifecycle');
  console.log('• Customer-driven downgrade path back to the free plan');
  console.log('• Feature resolution hierarchy (override > plan > default)');
  console.log('• Billing cycle management');
  console.log('');
  console.log('Key takeaways:');
  console.log('• Subscrio handles realistic subscription scenarios elegantly');
  console.log('• Feature overrides provide flexibility for custom needs');
  console.log('• Temporary overrides clear on renewal, permanent ones persist');
  console.log('• The API supports complete subscription lifecycle management');
  console.log('');
}

// ═══════════════════════════════════════════════════════════
// HELPER METHODS
// ═══════════════════════════════════════════════════════════

function extractDatabaseName(connectionString: string): string {
  try {
    // Parse PostgreSQL connection string
    // Format: postgresql://user:password@host:port/database
    const url = new URL(connectionString);
    const dbName = url.pathname.substring(1); // Remove leading slash
    return dbName || 'unknown';
  } catch (error) {
    // Fallback: try to extract database name using regex
    const match = connectionString.match(/\/([^/?]+)(?:\?|$)/);
    return match ? match[1] : 'unknown';
  }
}

function printHeader(connectionString: string) {
  const dbName = extractDatabaseName(connectionString);
  
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║         Subscrio Customer Lifecycle Demo                  ║');
  console.log('║         Scenario: ProjectHub SaaS Platform                ║');
  console.log('║                                                           ║');
  console.log(`║         Database: ${dbName.padEnd(39)} ║`);
  console.log('║                                                           ║');
  if (isInteractiveMode) {
    console.log('║         🔍 INTERACTIVE MODE ENABLED                      ║');
    console.log('║         (Pause after each step for database inspection) ║');
    console.log('║                                                           ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

function printPhase(phaseNum: number, title: string) {
  console.log('\n' + '═'.repeat(63));
  console.log(`  PHASE ${phaseNum}: ${title}`);
  console.log('═'.repeat(63) + '\n');
}

function printStep(stepNum: number, title: string) {
  console.log(`\n┌─ Step ${stepNum}: ${title}`);
  console.log('│');
}

function printSuccess(message: string) {
  console.log(`│ ✓ ${message}`);
}

function printInfo(message: string, indent: number = 1) {
  const prefix = '│' + '  '.repeat(indent);
  console.log(`${prefix}${message}`);
}

function printError(message: string) {
  console.log(`│ ❌ ${message}`);
}

function printDivider() {
  console.log('│');
  console.log('└' + '─'.repeat(61));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function promptForDatabaseInspection(phase: string, step: string) {
  if (!isInteractiveMode) return;
  
  console.log('\n' + '─'.repeat(63));
  console.log(`🔍 INTERACTIVE MODE: ${phase} - ${step}`);
  console.log('─'.repeat(63));
  console.log('Database state paused for inspection.');
  console.log('Check your database to see the current state.');
  console.log('Press ENTER to continue...');
  
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => {
      resolve();
    });
  });
  
  console.log('Continuing...\n');
}

async function promptDemoStart(automated: boolean = false) {
  if (automated) {
    console.log('\n🤖 RUNNING IN AUTOMATED MODE');
    console.log('═'.repeat(50));
    console.log('This demo will delete existing demo entities and then create the following entities:');
    console.log('');
    console.log('📦 PRODUCTS: projecthub');
    console.log('🔧 FEATURES: max-projects, max-users-per-project, gantt-charts, custom-branding, api-access');
    console.log('📋 PLANS: free, starter, professional, enterprise');
    console.log('💳 BILLING CYCLES: free-monthly, starter-monthly, starter-annual, professional-monthly, professional-annual, enterprise-monthly, enterprise-annual');
    console.log('👤 CUSTOMERS: acme-corp');
    console.log('🔄 SUBSCRIPTION LIFECYCLE: trial → purchase → upgrade → renewal → cancellation → downgrade');
    console.log('');
    console.log('⚠️  Please ensure you have a dedicated test database or');
    console.log('   are prepared to manually clean up these entities after the demo.');
    console.log('');
    console.log('🚀 Starting demo automatically...\n');
    return 'continue';
  }

  console.log('\n⚠️  IMPORTANT: Database Cleanup Required');
  console.log('═'.repeat(50));
  console.log('This demo will delete existing demo entities and then create the following entities:');
  console.log('');
  console.log('📦 PRODUCTS: projecthub');
  console.log('🔧 FEATURES: max-projects, max-users-per-project, gantt-charts, custom-branding, api-access');
  console.log('📋 PLANS: starter, professional, enterprise');
  console.log('💳 BILLING CYCLES: starter-monthly, starter-annual, professional-monthly, professional-annual, enterprise-monthly, enterprise-annual');
  console.log('👤 CUSTOMERS: acme-corp');
  console.log('🔄 SUBSCRIPTION LIFECYCLE: trial → purchase → upgrade → renewal');
  console.log('');
  console.log('⚠️  Please ensure you have a dedicated test database or');
  console.log('   are prepared to manually clean up these entities after the demo.');
  console.log('');
  console.log('Options:');
  console.log('  [ENTER] Continue with demo');
  console.log('  [q] Quit');
  console.log('  [i] Continue in interactive mode (pause after each step)');
  console.log('');
  console.log('Your choice: ');
  
  return new Promise<string>((resolve) => {
    process.stdin.once('data', (data) => {
      const input = data.toString().trim().toLowerCase();
      resolve(input);
    });
  });
}


async function cleanupDemoEntities(subscrio: Subscrio) {
  const db = (subscrio as any).db; // Access the database directly for cleanup
  
  console.log('🧹 Cleaning up existing demo entities...');

  // Helper function to safely delete (suppresses errors for missing tables or 0 rows)
  const safeDelete = async (query: string, description: string) => {
    try {
      await db.execute(sql.raw(query));
    } catch (error) {
      // Suppress errors for expected scenarios:
      // - Table doesn't exist (--recreate case)
      // - 0 rows affected (empty tables, normal case)
      const errorString = String(error).toLowerCase();
      const isExpected = 
        errorString.includes('does not exist') ||
        errorString.includes('relation') ||
        errorString.includes('0 rows') ||
        errorString.includes('no rows');
      
      if (!isExpected) {
        // Only log unexpected errors
        console.log(`⚠️  Warning: ${description} failed: ${error}`);
      }
    }
  };

  // Delete in reverse dependency order
  // Note: These may affect 0 rows or fail if tables don't exist (when using --recreate)
  console.log('🗑️  Deleting demo entities...');
  await safeDelete(
    `DELETE FROM subscrio.subscriptions WHERE key IN ('acme-subscription', 'acme-free-subscription')`,
    'Deleting subscriptions'
  );
  await safeDelete(`DELETE FROM subscrio.customers WHERE key = 'acme-corp'`, 'Deleting customers');
  await safeDelete(
    `DELETE FROM subscrio.billing_cycles WHERE key IN ('free-forever', 'starter-monthly', 'starter-annual', 'professional-monthly', 'professional-annual', 'enterprise-monthly', 'enterprise-annual')`,
    'Deleting billing cycles'
  );
  await safeDelete(
    `DELETE FROM subscrio.plans WHERE key IN ('free', 'starter', 'professional', 'enterprise')`,
    'Deleting plans'
  );
  await safeDelete(
    `DELETE FROM subscrio.features WHERE key IN ('max-projects', 'max-users-per-project', 'gantt-charts', 'custom-branding', 'api-access')`,
    'Deleting features'
  );
  await safeDelete(`DELETE FROM subscrio.products WHERE key = 'projecthub'`, 'Deleting products');

  console.log('✅ Demo entities cleanup completed');
  console.log('═'.repeat(50) + '\n');
}