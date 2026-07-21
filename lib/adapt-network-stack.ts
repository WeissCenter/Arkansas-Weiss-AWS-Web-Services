import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { AdaptStackProps } from "./adpat-stack-props";

export interface AdaptNetworkStackProps extends AdaptStackProps {
  /** CIDR for the Glue Data VPC. MUST NOT overlap any client's hub/spoke CIDR. */
  glueVpcCidr?: string;
}

/**
 * Shared connectivity for reaching clients' external SQL Server DBs: a single VPC
 * whose VGW terminates one static Site-to-Site VPN per client (via AdaptClientVpn).
 * Glue runs its ENIs in `glueSubnet`/`glueSecurityGroup`; routing sends each client's
 * DB CIDR down its tunnel. Subnets are isolated — AWS services are reached via the
 * VPC endpoints created here. See CLIENT_DB_CONNECTIVITY.md.
 */
export class AdaptNetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly glueSecurityGroup: ec2.SecurityGroup;
  public readonly glueSubnet: ec2.ISubnet;

  constructor(scope: Construct, id: string, props: AdaptNetworkStackProps) {
    super(scope, id, props);

    // CIDR comes from props (sourced from the GLUE_VPC_CIDR env in bin). It MUST
    // NOT overlap any client's hub/spoke CIDR — verify before changing.
    const vpcCidr = props.glueVpcCidr || "10.100.0.0/16";

    this.vpc = new ec2.Vpc(this, "GlueDataVpc", {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      maxAzs: 2,
      natGateways: 0, // no internet egress — AWS services reached via VPC endpoints below
      // Skip CDK's Custom::VpcRestrictDefaultSG hardening: it calls ec2:Authorize/Revoke
      // SecurityGroup* (which the deploy role may lack), and the default SG is never
      // attached to anything here — Glue ENIs use the dedicated GlueConnectionSG below.
      restrictDefaultSecurityGroup: false,
      subnetConfiguration: [
        {
          name: `${id}-glue`,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24
        }
      ],
      // Virtual Private Gateway: client Site-to-Site VPNs (AdaptClientVpn) attach here.
      vpnGateway: true,
      // Propagate VPN static routes into the isolated subnets' route tables so
      // traffic to each client's DB CIDR is sent down its tunnel.
      vpnRoutePropagation: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }]
    });

    // Security group attached to Glue ENIs. Glue requires a self-referencing
    // all-TCP inbound rule (executors talk to each other); egress is open so the
    // JDBC read can reach the client DB over the VPN.
    this.glueSecurityGroup = new ec2.SecurityGroup(this, "GlueConnectionSG", {
      vpc: this.vpc,
      description: "Glue ENIs for external client DB connections",
      allowAllOutbound: true
    });
    this.glueSecurityGroup.addIngressRule(this.glueSecurityGroup, ec2.Port.allTcp(), "Glue executor self-reference");

    this.glueSubnet = this.vpc.isolatedSubnets[0];

    // --- VPC endpoints so in-VPC Glue can reach AWS services without internet ---
    // Gateway endpoints (free):
    this.vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });
    this.vpc.addGatewayEndpoint("DynamoDbEndpoint", { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });

    // Interface endpoints (hourly + data cost) for the services Glue + the job use:
    const interfaceServices: { id: string; service: ec2.InterfaceVpcEndpointAwsService }[] = [
      { id: "SecretsManagerEndpoint", service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: "GlueEndpoint", service: ec2.InterfaceVpcEndpointAwsService.GLUE },
      { id: "StsEndpoint", service: ec2.InterfaceVpcEndpointAwsService.STS },
      { id: "CloudWatchLogsEndpoint", service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS }
    ];
    for (const { id: epId, service } of interfaceServices) {
      this.vpc.addInterfaceEndpoint(epId, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
      });
    }
  }

  /** Convenience accessors for wiring into the addNewDataSource handler env. */
  public get glueSubnetId(): string {
    return this.glueSubnet.subnetId;
  }
  public get glueSecurityGroupId(): string {
    return this.glueSecurityGroup.securityGroupId;
  }
  public get glueAz(): string {
    return this.glueSubnet.availabilityZone;
  }
}
