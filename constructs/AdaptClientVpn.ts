import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export interface AdaptClientVpnProps {
  /** The Glue Data VPC (must be created with `vpnGateway: true`). */
  vpc: ec2.IVpc;
  /** Short, stable client identifier used in resource names (e.g. "acme"). */
  clientName: string;
  /** Public IP of the client's VPN device / Azure VPN Gateway (customer gateway). */
  peerIp: string;
  /**
   * Client's private CIDR(s) to reach (where the SQL Server lives); added as static
   * routes. MUST NOT overlap our VPC or any other client's CIDR (checked at review).
   */
  clientCidrs: string[];
  /**
   * Customer gateway BGP ASN. Omit to use static routing (default ASN 65000).
   * Provide only if the client wants BGP.
   */
  asn?: number;
}

/**
 * One static Site-to-Site IPsec VPN to a single client network, declared once per
 * client (see CLIENT_DB_CONNECTIVITY.md). All tunnels terminate on the
 * shared Glue Data VPC's Virtual Private Gateway. After deploy, hand the client the
 * two AWS tunnel outside-IPs + device config so they can configure their side.
 */
export class AdaptClientVpn extends Construct {
  public readonly connection: ec2.VpnConnection;

  constructor(scope: Construct, id: string, props: AdaptClientVpnProps) {
    super(scope, id);

    this.connection = new ec2.VpnConnection(this, `${props.clientName}-vpn`, {
      vpc: props.vpc,
      ip: props.peerIp,
      asn: props.asn,
      // Providing static routes switches the connection to static-routing-only.
      // AWS Site-to-Site VPN negotiates IKEv2 when the peer supports it.
      staticRoutes: props.clientCidrs
    });
  }
}
