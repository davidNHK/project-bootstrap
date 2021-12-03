import { createRequestAgent } from '@api-test-helpers/create-request-agent';
import { expectResponseCode } from '@api-test-helpers/expect-response-code';
import { getTestName } from '@api-test-helpers/jest/get-test-name';
import { withNestServerContext } from '@api-test-helpers/nest-app-context';
import {
  applicationBuilder,
  createApplicationInDB,
} from '@api-test-helpers/seeders/applications';
import {
  couponBuilder,
  createCouponInDB,
} from '@api-test-helpers/seeders/coupons';
import { customBuilder } from '@api-test-helpers/seeders/customers';
import { orderBuilder } from '@api-test-helpers/seeders/orders';
import { productBuilder } from '@api-test-helpers/seeders/products';
import { describe, expect, it } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';

import { DiscountType } from '../constants/discount-type.constants';
import { CouponModule } from '../coupon.module';
import { TrackingService } from '../services/tracking.service';

const appContext = withNestServerContext({
  imports: [CouponModule],
});

function computeTrackingId(
  app: TestingModule,
  {
    coupon,
    customer,
    order,
  }: {
    coupon: {
      code: string;
    };
    customer: {
      id: string;
    };
    order: {
      id: string;
    };
  },
) {
  const trackingService = app.get(TrackingService);
  return trackingService.generateTrackingIds({ coupon, customer, order })?.[0];
}

describe('POST /v1/coupons/:code/validate', () => {
  it.each`
    couponCode           | discountType                  | coupon                  | exceptedOff             | amount   | deductedAmount
    ${'Percent25'}       | ${DiscountType.Percent}       | ${{ percentOff: 25 }}   | ${{ percentOff: 25 }}   | ${65000} | ${48800}
    ${'Percent50'}       | ${DiscountType.Percent}       | ${{ percentOff: 50 }}   | ${{ percentOff: 50 }}   | ${65000} | ${32500}
    ${'Amount100'}       | ${DiscountType.Amount}        | ${{ amountOff: 10000 }} | ${{ amountOff: 10000 }} | ${65000} | ${55000}
    ${'EffectAmount100'} | ${DiscountType.EffectAmount}  | ${{ amountOff: 10000 }} | ${{ amountOff: 0 }}     | ${65000} | ${65000}
    ${'EffectPercent50'} | ${DiscountType.EffectPercent} | ${{ percentOff: 50 }}   | ${{ amountOff: 0 }}     | ${65000} | ${65000}
  `(
    '$couponCode coupon should valid and deduct amount from $amount to $deductedAmount',
    async ({
      couponCode,
      discountType,
      coupon,
      amount,
      exceptedOff,
      deductedAmount,
    }) => {
      const { app } = appContext;
      const [application] = await createApplicationInDB(appContext.module, [
        applicationBuilder({
          name: getTestName(),
        }),
      ]);
      const product = productBuilder();
      const order = orderBuilder({
        amount: amount,
        items: [product],
      });
      const customer = customBuilder();
      const trackingId = computeTrackingId(appContext.module, {
        coupon: {
          code: couponCode,
        },
        customer: {
          id: customer.id,
        },
        order: {
          id: order.id,
        },
      });
      await createCouponInDB(appContext.module, [
        couponBuilder({
          active: true,
          code: couponCode,
          discountType: discountType,
          product: product.productId,
          ...coupon,
        }),
      ]);

      const { body } = await createRequestAgent(app.getHttpServer())
        .post(`/v1/coupons/${couponCode}/validate`)
        .send({
          customer: customer,
          order: order,
          trackingId: trackingId,
        })
        .set('X-App', application.name)
        .set('X-App-Token', application.serverSecretKey[0])
        .expect(expectResponseCode({ expectedStatusCode: 200 }));
      expect(body.data).toStrictEqual({
        code: couponCode,
        discountType: discountType,
        metadata: {},
        order: {
          totalAmount: deductedAmount,
          totalDiscountAmount: amount - deductedAmount,
          ...order,
        },
        trackingId: trackingId,
        valid: true,
        ...exceptedOff,
      });
    },
  );

  it('Can verify from client verify response', async () => {
    const app = appContext.app;
    const [application] = await createApplicationInDB(appContext.module, [
      applicationBuilder({
        name: getTestName(),
      }),
    ]);
    await createCouponInDB(appContext.module, [
      couponBuilder({
        active: true,
        code: 'FooBar!',
        discountType: DiscountType.Percent,
        percentOff: 25,
        product: 'incorporation',
      }),
    ]);
    const { body } = await createRequestAgent(app.getHttpServer())
      .post(`/client/v1/coupons/FooBar!/validate`)
      .send({
        customer: {
          id: 'fake-id',
        },
        order: {
          amount: 65000,
          id: 'fake-order-id',
          items: [
            {
              price: 65000,
              productId: 'incorporation',
              quantity: 1,
            },
          ],
        },
      })
      .set('X-Client-application', application.name)
      .set('X-Client-token', application.clientSecretKey[0])
      .expect(expectResponseCode({ expectedStatusCode: 200 }));
    await createRequestAgent(app.getHttpServer())
      .post(`/v1/coupons/FooBar!/validate`)
      .send({
        application: application.name,
        customer: {
          id: 'fake-id',
        },
        order: {
          amount: 650,
          id: 'fake-order-id',
          items: [
            {
              price: 65000,
              productId: 'incorporation',
              quantity: 1,
            },
          ],
        },
        trackingId: body.data.trackingId,
      })
      .set('X-App', application.name)
      .set('X-App-Token', application.serverSecretKey[0])
      .expect(expectResponseCode({ expectedStatusCode: 200 }));
  });

  it.each(['WWW', 'XYZ'])('report %s invalid', async code => {
    const app = appContext.app;
    const [application] = await createApplicationInDB(appContext.module, [
      applicationBuilder({
        name: getTestName(),
      }),
    ]);
    const { body } = await createRequestAgent(app.getHttpServer())
      .post(`/v1/coupons/${code}/validate`)
      .send({
        application: application.name,
        customer: {
          id: 'fake-id',
        },
        order: {
          amount: 65000,
          id: 'order-id',
          items: [
            {
              price: 65000,
              productId: 'incorporation',
              quantity: 1,
            },
          ],
        },
        trackingId: computeTrackingId(appContext.module, {
          coupon: {
            code: code,
          },
          customer: {
            id: 'fake-id',
          },
          order: {
            id: 'order-id',
          },
        }),
      })
      .set('X-App', application.name)
      .set('X-App-Token', application.serverSecretKey[0])
      .expect(expectResponseCode({ expectedStatusCode: 400 }));
    expect(body.code).toStrictEqual('ERR_UNKNOWN_COUPON_CODE');
  });
});